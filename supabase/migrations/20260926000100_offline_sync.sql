-- =============================================================================
-- Sincronización de la app Android (caja y ventas sin conexión)
--
-- La app guarda cada venta y cada turno en el teléfono con un id propio (uuid) y
-- los sube cuando hay internet. Las RPC de aquí son idempotentes: si un envío se
-- repite (se cortó la conexión antes de recibir la respuesta), devuelven lo que
-- ya se había registrado en vez de duplicarlo.
--
-- Una venta hecha sin conexión ya ocurrió: el cliente pagó y se llevó el
-- producto. Por eso, al sincronizarla, el servidor no la rechaza por falta de
-- stock ni por un producto desactivado: la registra y anota lo que no cuadró en
-- sale.sync_notes para que el administrador lo revise.
-- =============================================================================

alter table public.sale
  add column synced_at timestamptz,   -- cuándo llegó desde la app (null = venta hecha en la web)
  add column sync_notes text;         -- diferencias encontradas al sincronizar (stock, precio, vuelto)

-- -----------------------------------------------------------------------------
-- internal.create_sale con modo "sin conexión" (p_offline).
-- Cambios respecto a la versión anterior:
--   * p->>'id' fija el id de la venta (la app lo genera para poder reintentar).
--   * p_offline = true:
--       - producto desactivado: se vende igual; producto borrado: la línea queda sin product_id.
--       - stock insuficiente: se descuenta lo que hay (FEFO) y se anota el faltante.
--       - precio: si el producto cambió después de que el teléfono bajó el catálogo
--         (p->>'catalog_at'), se respeta el precio que se cobró y se anota; si no, manda el del servidor.
--       - efectivo recibido menor al total: se registra y se anota.
-- -----------------------------------------------------------------------------
drop function internal.create_sale(jsonb, uuid, uuid, timestamptz);

create function internal.create_sale(p jsonb, p_user uuid, p_session uuid, p_created timestamptz default now(), p_offline boolean default false)
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
  v_customer uuid;
begin
  if jsonb_array_length(coalesce(p->'items', '[]')) = 0 then raise exception 'La venta no tiene productos'; end if;

  -- Cliente (opcional, para boleta con DNI/RUC)
  if nullif(trim(p->'customer'->>'doc_number'), '') is not null then
    insert into public.customer (doc_type, doc_number, name)
    values (coalesce(nullif(p->'customer'->>'doc_type', ''), case when length(trim(p->'customer'->>'doc_number')) = 11 then 'RUC' else 'DNI' end),
            trim(p->'customer'->>'doc_number'), coalesce(nullif(trim(p->'customer'->>'name'), ''), 'Cliente'))
    on conflict (doc_number) do update set name = coalesce(nullif(trim(excluded.name), 'Cliente'), public.customer.name)
    returning id into v_customer;
  end if;

  insert into public.sale (id, cash_session_id, user_id, customer_id, customer_name, customer_doc, payment_method, note, created_at)
  values (coalesce(nullif(p->>'id', '')::uuid, gen_random_uuid()), p_session, p_user, v_customer, nullif(trim(p->'customer'->>'name'), ''),
          nullif(trim(p->'customer'->>'doc_number'), ''), v_method, p->>'note', p_created)
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
-- Venta desde la app.
-- p: lo mismo que pos_create_sale más
--   id           uuid generado en el teléfono (obligatorio; hace el envío idempotente)
--   cash_session_id  turno al que pertenece (ya sincronizado con cash_sync_open)
--   created_at   hora real de la venta
--   catalog_at   cuándo bajó el teléfono el catálogo (para decidir qué precio respetar)
--   strict       true = venta con conexión: se valida igual que en la web y se rechaza si no hay stock
--   items[].unit_price / product_name / units: lo que vio y cobró el cajero
-- -----------------------------------------------------------------------------
create or replace function public.pos_sync_sale(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_session uuid := nullif(p->>'cash_session_id', '')::uuid;
  v_created timestamptz := least(coalesce(nullif(p->>'created_at', '')::timestamptz, now()), now());
  v_strict boolean := coalesce((p->>'strict')::boolean, false);
begin
  perform internal.assert_staff();
  if v_id is null then raise exception 'Falta el id de la venta'; end if;
  -- Reintento: la venta ya llegó antes.
  if exists (select 1 from public.sale where id = v_id) then
    if not exists (select 1 from public.sale where id = v_id and user_id = auth.uid()) then raise exception 'No autorizado' using errcode = '42501'; end if;
    return internal.sale_json(v_id);
  end if;
  if v_session is null or not exists (select 1 from public.cash_session where id = v_session and user_id = auth.uid()) then
    raise exception 'El turno de caja de esta venta no existe en el servidor';
  end if;
  if v_strict and exists (select 1 from public.cash_session where id = v_session and closed_at is not null) then
    raise exception 'La caja está cerrada';
  end if;

  perform internal.create_sale(p, auth.uid(), v_session, v_created, not v_strict);
  update public.sale set synced_at = now() where id = v_id;
  return internal.sale_json(v_id);
end $$;

-- -----------------------------------------------------------------------------
-- Turnos de caja desde la app.
-- -----------------------------------------------------------------------------
-- Abre (o reconoce) el turno. Si el usuario ya tenía otro turno abierto (por ejemplo,
-- lo abrió en la web), la app lo adopta: devuelve ese turno y el teléfono usa su id.
create or replace function public.cash_sync_open(p_id uuid, p_amount numeric, p_opened_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  perform internal.assert_staff();
  if exists (select 1 from public.cash_session where id = p_id and user_id = auth.uid()) then return internal.cash_summary(p_id); end if;
  select id into v from public.cash_session where user_id = auth.uid() and closed_at is null;
  if v is not null then return internal.cash_summary(v); end if;
  insert into public.cash_session (id, user_id, opened_at, opening_amount)
  values (p_id, auth.uid(), least(coalesce(p_opened_at, now()), now()), greatest(coalesce(p_amount, 0), 0));
  return internal.cash_summary(p_id);
end $$;

-- Cierra el turno con la hora real del cierre. Si ya estaba cerrado (reintento o se cerró
-- en la web), no lo toca y devuelve cómo quedó.
create or replace function public.cash_sync_close(p_session uuid, p_counted numeric, p_note text default null, p_closed_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.cash_session;
  v_expected numeric;
begin
  perform internal.assert_staff();
  select * into v from public.cash_session where id = p_session and user_id = auth.uid() for update;
  if v.id is null then raise exception 'Turno de caja no encontrado'; end if;
  if v.closed_at is not null then return internal.cash_summary(v.id); end if;
  v_expected := (internal.cash_summary(v.id)->>'cash_expected')::numeric;
  update public.cash_session
     set closed_at = least(greatest(coalesce(p_closed_at, now()), v.opened_at), now()),
         expected_cash = v_expected, counted_cash = coalesce(p_counted, 0), note = nullif(trim(p_note), '')
   where id = v.id;
  return internal.cash_summary(v.id);
end $$;

revoke execute on function public.pos_sync_sale(jsonb) from anon;
revoke execute on function public.cash_sync_open(uuid, numeric, timestamptz) from anon;
revoke execute on function public.cash_sync_close(uuid, numeric, text, timestamptz) from anon;
