-- =============================================================================
-- Venta por blister
--   La botica vende por unidad y por blister (de 10 o, a veces, de 5 unidades). El blister
--   tiene su propio precio, menor que 10 unidades sueltas. Ya no hay precio de caja: la caja
--   son N blisters al precio del blister (price_pack lo calcula el trigger, así la app
--   Android, que todavía vende "caja", cobra lo mismo).
--   Sin precio de blister (frascos, ampollas, cajas que no se arman con blisters) todo sigue
--   como antes: unidad y caja.
-- =============================================================================

alter table public.product
  add column units_per_blister int not null default 10 check (units_per_blister in (5, 10)),
  add column price_blister numeric(10, 2) check (price_blister >= 0);

-- price_pack = precio blister × blisters por caja. Al crear un producto de tabletas o cápsulas
-- con precio de caja y sin precio de blister (importación del cuadro, app Android), el blister
-- sale del precio de la caja.
create or replace function internal.product_blister() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' and new.price_blister is null and new.price_pack is not null and new.form in ('tableta', 'capsula') then
    if new.units_per_pack % 10 <> 0 and new.units_per_pack % 5 = 0 then new.units_per_blister := 5; end if;
    if new.units_per_pack >= new.units_per_blister and new.units_per_pack % new.units_per_blister = 0 then
      new.price_blister := round(new.price_pack / (new.units_per_pack / new.units_per_blister), 2);
    end if;
  end if;
  if new.price_blister is not null and new.units_per_pack >= new.units_per_blister and new.units_per_pack % new.units_per_blister = 0 then
    new.price_pack := new.price_blister * (new.units_per_pack / new.units_per_blister);
  end if;
  return new;
end $$;

create trigger product_blister before insert or update on public.product for each row execute function internal.product_blister();

-- Productos que ya existen: igual que al crearlos.
update public.product set units_per_blister = 5
 where form in ('tableta', 'capsula') and units_per_pack % 10 <> 0 and units_per_pack % 5 = 0;
update public.product
   set price_blister = round(coalesce(price_pack, price_unit * units_per_pack) / (units_per_pack / units_per_blister), 2)
 where form in ('tableta', 'capsula') and price_blister is null
   and units_per_pack >= units_per_blister and units_per_pack % units_per_blister = 0;

-- La vista se arma con p.*: hay que recrearla para que traiga las columnas nuevas.
drop view public.product_stock;
create view public.product_stock with (security_invoker = true) as
select p.*,
       c.name as category_name,
       c.color as category_color,
       coalesce(s.sellable, 0)::int as stock,
       coalesce(s.expired, 0)::int as expired_units,
       s.next_expiry,
       coalesce(s.lots, 0)::int as lot_count,
       round(coalesce(s.sellable, 0) * p.cost_unit, 2) as stock_value,
       (coalesce(s.sellable, 0) <= p.min_stock) as is_low_stock
from public.product p
left join public.category c on c.id = p.category_id
left join lateral (
  select sum(l.quantity) filter (where l.expiry_date is null or l.expiry_date >= internal.today()) as sellable,
         sum(l.quantity) filter (where l.expiry_date < internal.today()) as expired,
         min(l.expiry_date) filter (where l.quantity > 0 and l.expiry_date >= internal.today()) as next_expiry,
         count(*) filter (where l.quantity > 0) as lots
  from public.lot l where l.product_id = p.id
) s on true;

-- Venta: unidad, blister o caja.
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
      raise exception '% no se vende por unidad', v_prod.name;
    end if;
    if v_unit = 'blister' and (v_prod.price_blister is null or v_prod.units_per_pack < v_prod.units_per_blister) and not p_offline then
      raise exception '% no se vende por blister', v_prod.name;
    end if;

    v_units := v_qty * case v_unit when 'caja' then v_prod.units_per_pack when 'blister' then v_prod.units_per_blister else 1 end;
    v_price := case v_unit
      when 'caja' then coalesce(v_prod.price_pack, v_prod.price_unit * v_prod.units_per_pack)
      when 'blister' then coalesce(v_prod.price_blister, v_prod.price_unit * v_prod.units_per_blister)
      else v_prod.price_unit end;
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

-- Producto nuevo desde la factura: con blister y su precio.
-- p: { id?, supplier_id? | supplier: { name, ruc? }, invoice_number?, note?, allow_duplicate?,
--      items: [{ product_id? | new_product: { name, generic_name?, form, presentation?, laboratory?, barcode?, units_per_pack, price_unit, price_pack?,
--                                units_per_blister?, price_blister? },
--                supplier_code?, lot_number, expiry_date, units, cost_unit }] }
create or replace function public.inv_receive_invoice(p jsonb) returns public.purchase
language plpgsql security definer set search_path = public as $$
declare
  v_sup uuid := nullif(p->>'supplier_id', '')::uuid;
  v_sup_name text := nullif(upper(trim(p->'supplier'->>'name')), '');
  v_sup_ruc text := nullif(regexp_replace(coalesce(p->'supplier'->>'ruc', ''), '\D', '', 'g'), '');
  v_item jsonb;
  v_np jsonb;
  v_prod uuid;
  v_barcode text;
  v_other text;
  v_items jsonb := '[]';
  v_dup bigint;
  v_client uuid := nullif(p->>'id', '')::uuid;
  v_purchase public.purchase;
begin
  perform internal.assert_staff();
  -- Reintento desde el teléfono: el ingreso ya se registró.
  if v_client is not null then
    select * into v_purchase from public.purchase where client_id = v_client;
    if v_purchase.id is not null then return v_purchase; end if;
  end if;
  if jsonb_array_length(coalesce(p->'items', '[]')) = 0 then raise exception 'El ingreso no tiene productos'; end if;

  if v_sup is null and v_sup_name is not null then
    select id into v_sup from public.supplier
     where (v_sup_ruc is not null and regexp_replace(coalesce(ruc, ''), '\D', '', 'g') = v_sup_ruc)
        or internal.norm(name) = internal.norm(v_sup_name)
     limit 1;
    if v_sup is null then
      insert into public.supplier (name, ruc) values (v_sup_name, v_sup_ruc) returning id into v_sup;
    end if;
  end if;

  if v_sup is not null and internal.invoice_key(p->>'invoice_number') is not null and not coalesce((p->>'allow_duplicate')::boolean, false) then
    select number into v_dup from public.purchase
     where supplier_id = v_sup and internal.invoice_key(invoice_number) = internal.invoice_key(p->>'invoice_number') limit 1;
    if v_dup is not null then raise exception 'Esta factura ya se registró en el ingreso #%', v_dup; end if;
  end if;

  for v_item in select * from jsonb_array_elements(p->'items') loop
    v_prod := nullif(v_item->>'product_id', '')::uuid;
    if v_prod is null then
      v_np := v_item->'new_product';
      if nullif(trim(v_np->>'name'), '') is null then raise exception 'Falta el nombre de un producto nuevo'; end if;
      if coalesce(nullif(v_np->>'price_unit', '')::numeric, 0) <= 0 then raise exception 'Indica el precio de venta de %', upper(trim(v_np->>'name')); end if;
      v_barcode := nullif(regexp_replace(coalesce(v_np->>'barcode', ''), '\s', '', 'g'), '');
      -- Si ya existe con el mismo nombre (o se creó en otra línea de esta factura), se usa ese.
      select id into v_prod from public.product where internal.norm(name) = internal.norm(trim(v_np->>'name')) order by is_active desc limit 1;
      if v_barcode is not null then
        select name into v_other from public.product where barcode = v_barcode and id is distinct from v_prod;
        if v_other is not null then raise exception 'El código % ya está asignado a %', v_barcode, v_other; end if;
        if v_prod is not null then
          update public.product set barcode = v_barcode where id = v_prod and barcode is null;
        end if;
      end if;
      if v_prod is null then
        insert into public.product (name, generic_name, form, presentation, laboratory, barcode, units_per_pack, sell_by_unit, price_unit, price_pack,
                                    units_per_blister, price_blister)
        values (upper(trim(v_np->>'name')), nullif(trim(v_np->>'generic_name'), ''),
                coalesce(nullif(v_np->>'form', ''), 'otro')::public.dosage_form, nullif(trim(v_np->>'presentation'), ''),
                nullif(upper(trim(v_np->>'laboratory')), ''), v_barcode, greatest(coalesce(nullif(v_np->>'units_per_pack', '')::int, 1), 1), true,
                (v_np->>'price_unit')::numeric, nullif(nullif(v_np->>'price_pack', '')::numeric, 0),
                case when v_np->>'units_per_blister' = '5' then 5 else 10 end, nullif(nullif(v_np->>'price_blister', '')::numeric, 0))
        returning id into v_prod;
      end if;
    end if;

    if v_sup is not null and nullif(trim(v_item->>'supplier_code'), '') is not null then
      insert into public.supplier_product (supplier_id, code, product_id) values (v_sup, trim(v_item->>'supplier_code'), v_prod)
      on conflict (supplier_id, code) do update set product_id = excluded.product_id, updated_at = now();
    end if;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'product_id', v_prod, 'lot_number', v_item->'lot_number', 'expiry_date', v_item->'expiry_date',
      'units', v_item->'units', 'cost_unit', v_item->'cost_unit'));
  end loop;

  v_purchase := internal.receive_purchase(
    jsonb_build_object('supplier_id', v_sup, 'invoice_number', p->'invoice_number', 'note', p->'note', 'items', v_items), auth.uid());
  if v_client is not null then
    update public.purchase set client_id = v_client where id = v_purchase.id returning * into v_purchase;
  end if;
  return v_purchase;
end $$;

