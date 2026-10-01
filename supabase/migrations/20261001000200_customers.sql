-- =============================================================================
-- Clientes
--   - Pantalla de clientes (web y app): todo el personal los ve, registra y edita,
--     también su historial de compras (decisión del dueño, aunque el cajero solo vea
--     sus propias ventas en el historial de ventas).
--   - En la venta se elige un cliente registrado (customer.id); si el DNI/RUC no está,
--     se registra antes con customer_save. La Edge Function customer-lookup ya no
--     guarda clientes: solo devuelve el nombre.
--   - La app registra clientes sin conexión con un id propio: customer_save es idempotente
--     por id y, al sincronizar (p.sync), une el cliente al que ya existe con ese documento.
-- =============================================================================

alter table public.customer
  add column email text,
  add column address text,
  add column note text,
  add column created_by uuid references auth.users (id) on delete set null,
  add column updated_at timestamptz not null default now();

create trigger customer_updated_at before update on public.customer for each row execute function internal.set_updated_at();
create index sale_customer_idx on public.sale (customer_id, created_at desc) where customer_id is not null;

-- Venta: enlaza el cliente por id (ver encabezado).
create or replace function internal.create_sale(p jsonb, p_user uuid, p_session uuid, p_created timestamptz default now(), p_offline boolean default false)
returns public.sale language plpgsql as $$
declare
  v_rate numeric := coalesce((select igv_rate from public.business limit 1), 18);
  v_catalog_at timestamptz := coalesce(nullif(p->>'catalog_at', '')::timestamptz, p_created);
  v_sale public.sale;
  v_item jsonb;
  v_prod public.product;
  v_name text;
  v_unit public.sale_unit;
  v_qty int;
  v_units int;
  v_price numeric;
  v_charged numeric;
  v_discount numeric;
  v_line numeric;
  v_line_id uuid;
  v_left int;
  v_take int;
  v_cost numeric;
  v_lot record;
  v_total numeric := 0;
  v_igv numeric := 0;
  v_cost_total numeric := 0;
  v_disc_total numeric := 0;
  v_count int := 0;
  v_notes text[] := '{}';
  v_method public.payment_method := coalesce(nullif(p->'payment'->>'method', ''), 'efectivo')::public.payment_method;
  v_received numeric := nullif(p->'payment'->>'received', '')::numeric;
  v_customer public.customer;
  v_doc text := nullif(upper(regexp_replace(coalesce(p->'customer'->>'doc_number', ''), '\s', '', 'g')), '');
  v_cname text := nullif(trim(p->'customer'->>'name'), '');
begin
  if jsonb_array_length(coalesce(p->'items', '[]')) = 0 then raise exception 'La venta no tiene productos'; end if;

  -- Cliente (opcional). Se elige por id entre los registrados; si no llega el id (versiones
  -- anteriores de la app) o no existe (se registró en el teléfono y el servidor lo unió a otro
  -- con el mismo documento), se busca por documento y, si no está, se registra.
  if nullif(p->'customer'->>'id', '') is not null then
    select * into v_customer from public.customer where id = (p->'customer'->>'id')::uuid;
  end if;
  if v_customer.id is null and v_doc is not null then
    insert into public.customer (doc_type, doc_number, name, created_by)
    values (coalesce(nullif(p->'customer'->>'doc_type', ''), case when length(v_doc) = 11 then 'RUC' else 'DNI' end),
            v_doc, coalesce(v_cname, 'Cliente'), p_user)
    on conflict (doc_number) do update
      set name = case when public.customer.name = 'Cliente' then coalesce(v_cname, 'Cliente') else public.customer.name end
    returning * into v_customer;
  end if;

  -- En la venta queda el nombre y documento de ese momento (el ticket no cambia si después se edita el cliente).
  insert into public.sale (id, cash_session_id, user_id, customer_id, customer_name, customer_doc, payment_method, note, created_at)
  values (coalesce(nullif(p->>'id', '')::uuid, gen_random_uuid()), p_session, p_user, v_customer.id,
          case when v_customer.id is not null then coalesce(nullif(v_customer.name, 'Cliente'), v_cname) else v_cname end,
          coalesce(v_customer.doc_number, v_doc), v_method, p->>'note', p_created)
  returning * into v_sale;

  for v_item in select * from jsonb_array_elements(p->'items') loop
    v_prod := null;
    select * into v_prod from public.product where id = nullif(v_item->>'product_id', '')::uuid for update;
    v_unit := coalesce(nullif(v_item->>'unit', ''), 'unidad')::public.sale_unit;
    v_qty := (v_item->>'quantity')::int;
    v_charged := nullif(v_item->>'unit_price', '')::numeric;

    if v_prod.id is null then
      -- Solo sin conexión: el producto se borró mientras el teléfono vendía. Se guarda la línea con los datos del teléfono.
      v_name := coalesce(nullif(trim(v_item->>'product_name'), ''), 'Producto');
      if not p_offline or v_charged is null or v_qty is null or v_qty <= 0 then raise exception 'Producto no disponible'; end if;
      v_units := greatest(coalesce((v_item->>'units')::int, v_qty), 1);
      v_line := round(greatest(v_charged, 0) * v_qty, 2);
      insert into public.sale_item (sale_id, product_id, product_name, unit, quantity, units, unit_price, total)
      values (v_sale.id, null, v_name, v_unit, v_qty, v_units, greatest(v_charged, 0), v_line);
      v_notes := v_notes || format('%s ya no existe en el catálogo: se registró sin descontar stock.', v_name);
      v_total := v_total + v_line;
      v_count := v_count + v_qty;
      v_igv := v_igv + (v_line - v_line / (1 + v_rate / 100));
      continue;
    end if;

    if not v_prod.is_active and not p_offline then raise exception 'Producto no disponible'; end if;
    if v_qty is null or v_qty <= 0 then raise exception 'Cantidad inválida para %', v_prod.name; end if;
    if v_unit = 'unidad' and not v_prod.sell_by_unit and v_prod.units_per_pack > 1 and not p_offline then
      raise exception '% solo se vende por caja', v_prod.name;
    end if;

    v_units := v_qty * case when v_unit = 'caja' then v_prod.units_per_pack else 1 end;
    v_price := case when v_unit = 'caja' then coalesce(v_prod.price_pack, v_prod.price_unit * v_prod.units_per_pack) else v_prod.price_unit end;
    if p_offline and v_charged is not null and v_charged >= 0 and v_charged <> v_price then
      if v_prod.updated_at > v_catalog_at then
        v_notes := v_notes || format('%s: se cobró S/ %s (%s); el precio actual es S/ %s.', v_prod.name, to_char(v_charged, 'FM999990.00'), v_unit, to_char(v_price, 'FM999990.00'));
        v_price := v_charged;
      else
        v_notes := v_notes || format('%s: el teléfono envió S/ %s (%s) pero el precio no había cambiado; se usó S/ %s.', v_prod.name, to_char(v_charged, 'FM999990.00'), v_unit, to_char(v_price, 'FM999990.00'));
      end if;
    end if;
    v_line := round(v_price * v_qty, 2);
    v_discount := least(greatest(coalesce((v_item->>'discount')::numeric, 0), 0), v_line);
    v_line := v_line - v_discount;

    insert into public.sale_item (sale_id, product_id, product_name, description, unit, quantity, units, unit_price, discount, total, igv_exempt)
    values (v_sale.id, v_prod.id, v_prod.name, nullif(concat_ws(' · ', v_prod.concentration, v_prod.presentation), ''), v_unit, v_qty, v_units,
            v_price, v_discount, v_line, v_prod.igv_exempt)
    returning id into v_line_id;

    -- FEFO: descuenta primero de los lotes que vencen antes (nunca de lotes vencidos).
    v_left := v_units;
    v_cost := 0;
    for v_lot in
      select id, quantity, cost_unit from public.lot
      where product_id = v_prod.id and quantity > 0 and (expiry_date is null or expiry_date >= (p_created at time zone 'America/Lima')::date)
      order by expiry_date nulls last, received_at
      for update
    loop
      exit when v_left = 0;
      v_take := least(v_left, v_lot.quantity);
      update public.lot set quantity = quantity - v_take where id = v_lot.id;
      insert into public.sale_item_lot (sale_item_id, lot_id, units) values (v_line_id, v_lot.id, v_take);
      perform internal.record_movement(v_prod.id, v_lot.id, 'venta', -v_take, v_sale.id, 'Venta #' || v_sale.number, p_user, p_created);
      v_cost := v_cost + v_take * coalesce(nullif(v_lot.cost_unit, 0), v_prod.cost_unit);
      v_left := v_left - v_take;
    end loop;
    if v_left > 0 then
      if not p_offline then
        raise exception 'Stock insuficiente de %: solo hay % unidades disponibles', v_prod.name, v_units - v_left;
      end if;
      v_notes := v_notes || format('%s: faltaron %s u. en el sistema al sincronizar (revisa el inventario).', v_prod.name, v_left);
      v_cost := v_cost + v_left * v_prod.cost_unit;
    end if;

    update public.sale_item set cost_total = round(v_cost, 2) where id = v_line_id;
    v_total := v_total + v_line;
    v_disc_total := v_disc_total + v_discount;
    v_cost_total := v_cost_total + v_cost;
    v_count := v_count + v_qty;
    if not v_prod.igv_exempt then v_igv := v_igv + (v_line - v_line / (1 + v_rate / 100)); end if;
  end loop;

  if v_method = 'efectivo' then
    v_received := coalesce(v_received, v_total);
    if v_received < v_total then
      if not p_offline then
        raise exception 'El monto recibido (S/ %) es menor al total (S/ %)', v_received, v_total;
      end if;
      v_notes := v_notes || format('Se recibió S/ %s y el total quedó en S/ %s.', to_char(v_received, 'FM999990.00'), to_char(v_total, 'FM999990.00'));
    end if;
  else
    v_received := null;
  end if;

  update public.sale set
    total = v_total, igv = round(v_igv, 2), subtotal = v_total - round(v_igv, 2), discount_total = v_disc_total,
    cost_total = round(v_cost_total, 2), item_count = v_count,
    amount_received = v_received, change_given = case when v_received is not null then greatest(v_received - v_total, 0) end,
    sync_notes = nullif(array_to_string(v_notes, E'\n'), '')
  where id = v_sale.id
  returning * into v_sale;
  return v_sale;
end $$;

-- -----------------------------------------------------------------------------
-- Lista de clientes con lo que compraron (ventas completadas). Corre como dueño para
-- sumar todas las ventas, también las de otros cajeros.
-- -----------------------------------------------------------------------------
create view public.customer_list as
select c.*, coalesce(s.sales_count, 0) as sales_count, coalesce(s.sales_total, 0) as sales_total, s.last_sale_at
from public.customer c
left join lateral (
  select count(*) as sales_count, sum(total) as sales_total, max(created_at) as last_sale_at
  from public.sale where customer_id = c.id and status = 'completada'
) s on true
where internal.is_staff();

revoke all on public.customer_list from anon;

create or replace function internal.customer_json(p_customer uuid) returns jsonb language sql stable as $$
  select to_jsonb(c) from public.customer_list c where c.id = p_customer
$$;

-- -----------------------------------------------------------------------------
-- Registrar o editar un cliente (todo el personal).
-- p: { id?, doc_type?, doc_number, name, phone?, email?, address?, note?, sync? }
--   id     si existe se edita; si no, se crea con ese id (la app lo genera: reintentar no duplica)
--   sync   true = viene de la cola de la app: si el documento ya es de otro cliente, se unen
--          (se completan los datos que falten) en vez de rechazarlo.
-- Si el documento ya existe pero ese cliente no tiene datos de contacto (lo registró una venta
-- o la búsqueda por DNI), se completa ese mismo cliente.
-- -----------------------------------------------------------------------------
create or replace function public.customer_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_doc text := upper(regexp_replace(coalesce(p->>'doc_number', ''), '\s|-', '', 'g'));
  v_type text := upper(coalesce(nullif(trim(p->>'doc_type'), ''), case when length(v_doc) = 11 then 'RUC' else 'DNI' end));
  v_name text := nullif(upper(regexp_replace(trim(coalesce(p->>'name', '')), '\s+', ' ', 'g')), '');
  v_phone text := nullif(trim(coalesce(p->>'phone', '')), '');
  v_email text := nullif(lower(trim(coalesce(p->>'email', ''))), '');
  v_address text := nullif(trim(coalesce(p->>'address', '')), '');
  v_note text := nullif(trim(coalesce(p->>'note', '')), '');
  v_sync boolean := coalesce((p->>'sync')::boolean, false);
  v_self public.customer;
  v_other public.customer;
begin
  perform internal.assert_staff();
  if v_type not in ('DNI', 'RUC', 'CE', 'PAS') then raise exception 'Tipo de documento inválido'; end if;
  if v_type = 'DNI' and v_doc !~ '^\d{8}$' then raise exception 'El DNI debe tener 8 dígitos'; end if;
  if v_type = 'RUC' and v_doc !~ '^\d{11}$' then raise exception 'El RUC debe tener 11 dígitos'; end if;
  if v_type in ('CE', 'PAS') and v_doc !~ '^[A-Z0-9]{5,15}$' then raise exception 'Número de documento inválido'; end if;
  if v_name is null or v_name = 'CLIENTE' then raise exception 'Escribe el nombre del cliente'; end if;
  if length(v_name) > 200 then raise exception 'El nombre es demasiado largo'; end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9 ]{6,20}$' then raise exception 'Teléfono inválido'; end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Correo inválido'; end if;

  if v_id is not null then select * into v_self from public.customer where id = v_id for update; end if;
  select * into v_other from public.customer where doc_number = v_doc and id is distinct from v_self.id for update;

  if v_other.id is not null then
    if v_self.id is not null and not v_sync then
      raise exception 'El documento % ya es de otro cliente: %', v_doc, v_other.name;
    end if;
    if v_self.id is null and not v_sync and coalesce(v_other.phone, v_other.email, v_other.address, v_other.note) is not null then
      raise exception 'Ya existe un cliente con el documento %: %', v_doc, v_other.name;
    end if;
    if v_self.id is null and not v_sync then
      -- Registro sin datos de contacto (de una venta o de la búsqueda por DNI): se completa.
      update public.customer
         set doc_type = v_type, name = v_name, phone = v_phone, email = v_email, address = v_address, note = v_note
       where id = v_other.id;
    else
      -- Sincronización: gana lo que ya está en el servidor; solo se completan los datos vacíos.
      update public.customer
         set name = case when name = 'Cliente' then v_name else name end,
             phone = coalesce(phone, v_phone), email = coalesce(email, v_email),
             address = coalesce(address, v_address), note = coalesce(note, v_note)
       where id = v_other.id;
    end if;
    return internal.customer_json(v_other.id);
  end if;

  if v_self.id is not null then
    update public.customer
       set doc_type = v_type, doc_number = v_doc, name = v_name, phone = v_phone, email = v_email, address = v_address, note = v_note
     where id = v_self.id;
    return internal.customer_json(v_self.id);
  end if;

  insert into public.customer (id, doc_type, doc_number, name, phone, email, address, note, created_by)
  values (coalesce(v_id, gen_random_uuid()), v_type, v_doc, v_name, v_phone, v_email, v_address, v_note, auth.uid())
  returning id into v_id;
  return internal.customer_json(v_id);
end $$;

-- -----------------------------------------------------------------------------
-- Compras de un cliente (todo el personal), las más recientes primero, con sus productos.
-- -----------------------------------------------------------------------------
create or replace function public.customer_sales(p_customer uuid, p_limit int default 100) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform internal.assert_staff();
  return (
    select coalesce(jsonb_agg(x order by x.created_at desc), '[]')
    from (
      select s.id, s.number, s.created_at, s.status, s.total, s.payment_method, s.item_count, s.user_id,
             nullif(concat_ws(' ', st.first_name, st.last_name), '') as cashier,
             (select coalesce(jsonb_agg(jsonb_build_object('product_name', i.product_name, 'unit', i.unit, 'quantity', i.quantity, 'total', i.total)
                                        order by i.product_name), '[]')
                from public.sale_item i where i.sale_id = s.id) as items
      from public.sale s
      left join public.staff st on st.user_id = s.user_id
      where s.customer_id = p_customer
      order by s.created_at desc
      limit least(greatest(coalesce(p_limit, 100), 1), 500)
    ) x
  );
end $$;

revoke execute on function public.customer_save(jsonb), public.customer_sales(uuid, int) from anon;
