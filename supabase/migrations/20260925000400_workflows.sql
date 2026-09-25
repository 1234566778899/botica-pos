-- =============================================================================
-- Workflows transaccionales. Toda escritura con lógica pasa por aquí:
--   pos_*   punto de venta        inv_*   inventario
--   cash_*  caja                  dashboard()  panel
-- =============================================================================

-- Registra un movimiento en el kardex (llamar DESPUÉS de actualizar el lote).
create or replace function internal.record_movement(p_product uuid, p_lot uuid, p_type public.movement_type, p_units int,
                                                    p_reference uuid, p_note text, p_user uuid, p_created timestamptz default now())
returns void language sql as $$
  insert into public.stock_movement (product_id, lot_id, type, units, balance, reference_id, note, user_id, created_at)
  values (p_product, p_lot, p_type, p_units, internal.total_units(p_product), p_reference, p_note, p_user, p_created)
$$;

-- -----------------------------------------------------------------------------
-- Venta
-- p: { items: [{ product_id, unit: "unidad"|"caja", quantity, discount? }],
--      payment: { method, received? }, customer?: { doc_type?, doc_number, name }, note? }
-- -----------------------------------------------------------------------------
create or replace function internal.create_sale(p jsonb, p_user uuid, p_session uuid, p_created timestamptz default now())
returns public.sale language plpgsql as $$
declare
  v_rate numeric := coalesce((select igv_rate from public.business limit 1), 18);
  v_sale public.sale;
  v_item jsonb;
  v_prod public.product;
  v_unit public.sale_unit;
  v_qty int;
  v_units int;
  v_price numeric;
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

  insert into public.sale (cash_session_id, user_id, customer_id, customer_name, customer_doc, payment_method, note, created_at)
  values (p_session, p_user, v_customer, nullif(trim(p->'customer'->>'name'), ''), nullif(trim(p->'customer'->>'doc_number'), ''), v_method, p->>'note', p_created)
  returning * into v_sale;

  for v_item in select * from jsonb_array_elements(p->'items') loop
    select * into v_prod from public.product where id = (v_item->>'product_id')::uuid for update;
    if v_prod.id is null or not v_prod.is_active then raise exception 'Producto no disponible'; end if;

    v_unit := coalesce(nullif(v_item->>'unit', ''), 'unidad')::public.sale_unit;
    v_qty := (v_item->>'quantity')::int;
    if v_qty is null or v_qty <= 0 then raise exception 'Cantidad inválida para %', v_prod.name; end if;
    if v_unit = 'unidad' and not v_prod.sell_by_unit and v_prod.units_per_pack > 1 then
      raise exception '% solo se vende por caja', v_prod.name;
    end if;

    v_units := v_qty * case when v_unit = 'caja' then v_prod.units_per_pack else 1 end;
    v_price := case when v_unit = 'caja' then coalesce(v_prod.price_pack, v_prod.price_unit * v_prod.units_per_pack) else v_prod.price_unit end;
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
      raise exception 'Stock insuficiente de %: solo hay % unidades disponibles', v_prod.name, v_units - v_left;
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
    if v_received < v_total then raise exception 'El monto recibido (S/ %) es menor al total (S/ %)', v_received, v_total; end if;
  else
    v_received := null;
  end if;

  update public.sale set
    total = v_total, igv = round(v_igv, 2), subtotal = v_total - round(v_igv, 2), discount_total = v_disc_total,
    cost_total = round(v_cost_total, 2), item_count = v_count,
    amount_received = v_received, change_given = case when v_received is not null then v_received - v_total end
  where id = v_sale.id
  returning * into v_sale;
  return v_sale;
end $$;

-- Venta completa (con líneas) para imprimir el ticket.
create or replace function internal.sale_json(p_sale uuid) returns jsonb language sql stable as $$
  select to_jsonb(s) || jsonb_build_object(
    'items', (select coalesce(jsonb_agg(to_jsonb(i) order by i.product_name), '[]') from public.sale_item i where i.sale_id = s.id),
    'cashier', (select concat_ws(' ', st.first_name, st.last_name) from public.staff st where st.user_id = s.user_id))
  from public.sale s where s.id = p_sale
$$;

create or replace function public.pos_create_sale(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_session uuid;
  v_sale public.sale;
begin
  perform internal.assert_staff();
  select id into v_session from public.cash_session where user_id = auth.uid() and closed_at is null;
  if v_session is null then raise exception 'Abre la caja antes de vender'; end if;
  v_sale := internal.create_sale(p, auth.uid(), v_session);
  return internal.sale_json(v_sale.id);
end $$;

create or replace function public.pos_sale(p_sale uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform internal.assert_staff();
  return internal.sale_json(p_sale);
end $$;

-- Anular venta: devuelve el stock a los mismos lotes. Solo administradores.
create or replace function public.pos_void_sale(p_sale uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sale public.sale;
  r record;
begin
  perform internal.assert_admin();
  if nullif(trim(p_reason), '') is null then raise exception 'Indica el motivo de la anulación'; end if;
  select * into v_sale from public.sale where id = p_sale for update;
  if v_sale.id is null then raise exception 'Venta no encontrada'; end if;
  if v_sale.status = 'anulada' then raise exception 'La venta ya está anulada'; end if;

  for r in select sil.lot_id, sil.units, l.product_id from public.sale_item_lot sil
           join public.sale_item si on si.id = sil.sale_item_id join public.lot l on l.id = sil.lot_id
           where si.sale_id = p_sale loop
    update public.lot set quantity = quantity + r.units where id = r.lot_id;
    perform internal.record_movement(r.product_id, r.lot_id, 'anulacion', r.units, p_sale, 'Anulación venta #' || v_sale.number || ': ' || trim(p_reason), auth.uid());
  end loop;

  update public.sale set status = 'anulada', voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason) where id = p_sale;
  return internal.sale_json(p_sale);
end $$;

-- -----------------------------------------------------------------------------
-- Inventario
-- -----------------------------------------------------------------------------
-- Ingreso de mercadería.
-- p: { supplier_id?, invoice_number?, note?, items: [{ product_id, lot_number, expiry_date, units, cost_unit }] }
create or replace function internal.receive_purchase(p jsonb, p_user uuid, p_created timestamptz default now())
returns public.purchase language plpgsql as $$
declare
  v_purchase public.purchase;
  v_item jsonb;
  v_prod public.product;
  v_lot public.lot;
  v_units int;
  v_cost numeric;
  v_stock int;
  v_total numeric := 0;
begin
  if jsonb_array_length(coalesce(p->'items', '[]')) = 0 then raise exception 'El ingreso no tiene productos'; end if;
  insert into public.purchase (supplier_id, invoice_number, note, user_id, created_at)
  values (nullif(p->>'supplier_id', '')::uuid, nullif(trim(p->>'invoice_number'), ''), nullif(trim(p->>'note'), ''), p_user, p_created)
  returning * into v_purchase;

  for v_item in select * from jsonb_array_elements(p->'items') loop
    select * into v_prod from public.product where id = (v_item->>'product_id')::uuid for update;
    if v_prod.id is null then raise exception 'Producto no encontrado'; end if;
    v_units := (v_item->>'units')::int;
    if v_units is null or v_units <= 0 then raise exception 'Cantidad inválida para %', v_prod.name; end if;
    if nullif(trim(v_item->>'lot_number'), '') is null then raise exception 'Indica el número de lote de %', v_prod.name; end if;
    v_cost := coalesce(nullif(v_item->>'cost_unit', '')::numeric, v_prod.cost_unit);
    v_stock := internal.sellable_units(v_prod.id);

    insert into public.lot (product_id, lot_number, expiry_date, quantity, cost_unit, received_at)
    values (v_prod.id, upper(trim(v_item->>'lot_number')), nullif(v_item->>'expiry_date', '')::date, v_units, v_cost, p_created)
    on conflict (product_id, lot_number, expiry_date) do update
      set cost_unit = round((public.lot.quantity * public.lot.cost_unit + excluded.quantity * excluded.cost_unit) / nullif(public.lot.quantity + excluded.quantity, 0), 4),
          quantity = public.lot.quantity + excluded.quantity
    returning * into v_lot;

    -- Costo promedio ponderado del producto.
    update public.product set cost_unit = round((v_stock * cost_unit + v_units * v_cost) / nullif(v_stock + v_units, 0), 4) where id = v_prod.id;

    insert into public.purchase_item (purchase_id, product_id, lot_id, lot_number, expiry_date, units, cost_unit)
    values (v_purchase.id, v_prod.id, v_lot.id, v_lot.lot_number, v_lot.expiry_date, v_units, v_cost);
    perform internal.record_movement(v_prod.id, v_lot.id, 'compra', v_units, v_purchase.id, 'Ingreso #' || v_purchase.number, p_user, p_created);
    v_total := v_total + round(v_units * v_cost, 2);
  end loop;

  update public.purchase set total = v_total where id = v_purchase.id returning * into v_purchase;
  return v_purchase;
end $$;

create or replace function public.inv_receive_purchase(p jsonb) returns public.purchase
language plpgsql security definer set search_path = public as $$
begin
  perform internal.assert_staff();
  return internal.receive_purchase(p, auth.uid());
end $$;

-- Ajuste de un lote: conteo físico, vencido (baja) o merma. Solo administradores.
create or replace function public.inv_adjust_lot(p_lot uuid, p_new_quantity int, p_type public.movement_type, p_note text)
returns public.lot language plpgsql security definer set search_path = public as $$
declare
  v_lot public.lot;
  v_delta int;
begin
  perform internal.assert_admin();
  if p_type not in ('ajuste', 'vencido', 'merma') then raise exception 'Tipo de ajuste inválido'; end if;
  if p_new_quantity is null or p_new_quantity < 0 then raise exception 'La cantidad no puede ser negativa'; end if;
  select * into v_lot from public.lot where id = p_lot for update;
  if v_lot.id is null then raise exception 'Lote no encontrado'; end if;
  v_delta := p_new_quantity - v_lot.quantity;
  if v_delta = 0 then return v_lot; end if;
  update public.lot set quantity = p_new_quantity where id = p_lot returning * into v_lot;
  perform internal.record_movement(v_lot.product_id, v_lot.id, p_type, v_delta, null, nullif(trim(p_note), ''), auth.uid());
  return v_lot;
end $$;

-- Dar de baja todos los lotes vencidos de una vez.
create or replace function public.inv_write_off_expired() returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_count int := 0;
begin
  perform internal.assert_admin();
  for r in select id, product_id, quantity, lot_number from public.lot where quantity > 0 and expiry_date < internal.today() for update loop
    update public.lot set quantity = 0 where id = r.id;
    perform internal.record_movement(r.product_id, r.id, 'vencido', -r.quantity, null, 'Baja por vencimiento (lote ' || r.lot_number || ')', auth.uid());
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- -----------------------------------------------------------------------------
-- Caja
-- -----------------------------------------------------------------------------
create or replace function internal.cash_summary(p_session uuid) returns jsonb language sql stable as $$
  select to_jsonb(cs) || jsonb_build_object(
    'cashier', (select concat_ws(' ', st.first_name, st.last_name) from public.staff st where st.user_id = cs.user_id),
    'sales_count', (select count(*) from public.sale where cash_session_id = cs.id and status = 'completada'),
    'sales_total', (select coalesce(sum(total), 0) from public.sale where cash_session_id = cs.id and status = 'completada'),
    'voided_count', (select count(*) from public.sale where cash_session_id = cs.id and status = 'anulada'),
    'by_method', (select coalesce(jsonb_object_agg(m, t), '{}') from (
        select payment_method::text as m, sum(total) as t from public.sale where cash_session_id = cs.id and status = 'completada' group by 1) x),
    'cash_expected', cs.opening_amount + (select coalesce(sum(total), 0) from public.sale
                                          where cash_session_id = cs.id and status = 'completada' and payment_method = 'efectivo'))
  from public.cash_session cs where cs.id = p_session
$$;

-- Turno abierto del usuario actual (null si la caja está cerrada).
create or replace function public.cash_current() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  perform internal.assert_staff();
  select id into v from public.cash_session where user_id = auth.uid() and closed_at is null;
  return case when v is null then null else internal.cash_summary(v) end;
end $$;

create or replace function public.cash_open(p_amount numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  perform internal.assert_staff();
  if exists (select 1 from public.cash_session where user_id = auth.uid() and closed_at is null) then raise exception 'Ya tienes la caja abierta'; end if;
  insert into public.cash_session (user_id, opening_amount) values (auth.uid(), greatest(coalesce(p_amount, 0), 0)) returning id into v;
  return internal.cash_summary(v);
end $$;

create or replace function public.cash_close(p_counted numeric, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v uuid;
  v_expected numeric;
begin
  perform internal.assert_staff();
  select id into v from public.cash_session where user_id = auth.uid() and closed_at is null for update;
  if v is null then raise exception 'No tienes una caja abierta'; end if;
  v_expected := (internal.cash_summary(v)->>'cash_expected')::numeric;
  update public.cash_session set closed_at = now(), expected_cash = v_expected, counted_cash = coalesce(p_counted, 0), note = nullif(trim(p_note), '') where id = v;
  return internal.cash_summary(v);
end $$;

create or replace function public.cash_session_detail(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform internal.assert_staff();
  if not internal.is_admin() and not exists (select 1 from public.cash_session where id = p_session and user_id = auth.uid()) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  return internal.cash_summary(p_session);
end $$;

-- -----------------------------------------------------------------------------
-- Panel (solo administradores): ventas del periodo, vencimientos, stock bajo…
-- Fechas en hora de Lima, ambos extremos incluidos.
-- -----------------------------------------------------------------------------
create or replace function public.dashboard(p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_to date := coalesce(p_to, internal.today());
  v_from date := coalesce(p_from, v_to);
  v_days int := v_to - v_from + 1;
  v_warn int := coalesce((select expiry_warning_days from public.business limit 1), 90);
  v_today date := internal.today();
begin
  perform internal.assert_admin();
  return jsonb_build_object(
    'from', v_from, 'to', v_to,
    'totals', (select jsonb_build_object('sales', coalesce(sum(total), 0), 'count', count(*), 'profit', coalesce(sum(total - cost_total), 0),
                                         'items', coalesce(sum(item_count), 0), 'avg_ticket', coalesce(round(avg(total), 2), 0))
               from public.sale where status = 'completada' and (created_at at time zone 'America/Lima')::date between v_from and v_to),
    'previous', (select jsonb_build_object('sales', coalesce(sum(total), 0), 'count', count(*), 'profit', coalesce(sum(total - cost_total), 0))
                 from public.sale where status = 'completada'
                   and (created_at at time zone 'America/Lima')::date between v_from - v_days and v_from - 1),
    'voided', (select count(*) from public.sale where status = 'anulada' and (created_at at time zone 'America/Lima')::date between v_from and v_to),
    -- Un día: por hora; varios días: por día.
    'series', case when v_days = 1 then
        (select jsonb_agg(jsonb_build_object('label', lpad(h::text, 2, '0') || ':00', 'sales', coalesce(t.s, 0), 'count', coalesce(t.c, 0)) order by h)
         from generate_series(7, 22) h
         left join (select extract(hour from created_at at time zone 'America/Lima')::int hr, sum(total) s, count(*) c from public.sale
                    where status = 'completada' and (created_at at time zone 'America/Lima')::date = v_from group by 1) t on t.hr = h)
      else
        (select jsonb_agg(jsonb_build_object('label', to_char(d, 'YYYY-MM-DD'), 'sales', coalesce(t.s, 0), 'count', coalesce(t.c, 0)) order by d)
         from generate_series(v_from, v_to, interval '1 day') d
         left join (select (created_at at time zone 'America/Lima')::date dd, sum(total) s, count(*) c from public.sale
                    where status = 'completada' and (created_at at time zone 'America/Lima')::date between v_from and v_to group by 1) t on t.dd = d::date)
      end,
    'by_method', (select coalesce(jsonb_agg(jsonb_build_object('method', m, 'total', t, 'count', c) order by t desc), '[]') from (
        select payment_method::text m, sum(total) t, count(*) c from public.sale
        where status = 'completada' and (created_at at time zone 'America/Lima')::date between v_from and v_to group by 1) x),
    'top_products', (select coalesce(jsonb_agg(x order by x.revenue desc), '[]') from (
        select si.product_id, si.product_name as name, sum(si.units) as units, sum(si.total) as revenue
        from public.sale_item si join public.sale s on s.id = si.sale_id
        where s.status = 'completada' and (s.created_at at time zone 'America/Lima')::date between v_from and v_to
        group by 1, 2 order by 4 desc limit 8) x),
    'by_category', (select coalesce(jsonb_agg(x order by x.revenue desc), '[]') from (
        select coalesce(c.name, 'Sin categoría') as name, coalesce(c.color, '#8a8a8a') as color, sum(si.total) as revenue
        from public.sale_item si join public.sale s on s.id = si.sale_id
        left join public.product p on p.id = si.product_id left join public.category c on c.id = p.category_id
        where s.status = 'completada' and (s.created_at at time zone 'America/Lima')::date between v_from and v_to
        group by 1, 2) x),
    'expiring', jsonb_build_object(
        'days', v_warn,
        'in_30', (select count(*) from public.lot where quantity > 0 and expiry_date between v_today and v_today + 30),
        'in_60', (select count(*) from public.lot where quantity > 0 and expiry_date between v_today and v_today + 60),
        'in_warn', (select count(*) from public.lot where quantity > 0 and expiry_date between v_today and v_today + v_warn),
        'value', (select coalesce(sum(value), 0) from public.lot_status where days_to_expiry between 0 and v_warn),
        'lots', (select coalesce(jsonb_agg(x order by x.expiry_date), '[]') from (
            select id, product_id, product_name, concentration, presentation, lot_number, expiry_date, quantity, days_to_expiry, value
            from public.lot_status where days_to_expiry between 0 and v_warn order by expiry_date limit 12) x)),
    'expired', jsonb_build_object(
        'count', (select count(*) from public.lot where quantity > 0 and expiry_date < v_today),
        'units', (select coalesce(sum(quantity), 0) from public.lot where quantity > 0 and expiry_date < v_today),
        'value', (select coalesce(sum(value), 0) from public.lot_status where days_to_expiry < 0),
        'lots', (select coalesce(jsonb_agg(x order by x.expiry_date), '[]') from (
            select id, product_id, product_name, concentration, lot_number, expiry_date, quantity, days_to_expiry, value
            from public.lot_status where days_to_expiry < 0 order by expiry_date limit 12) x)),
    'low_stock', jsonb_build_object(
        'count', (select count(*) from public.product_stock where is_active and is_low_stock),
        'products', (select coalesce(jsonb_agg(x order by x.stock), '[]') from (
            select id, name, concentration, presentation, stock, min_stock, units_per_pack from public.product_stock
            where is_active and is_low_stock order by stock, name limit 12) x)),
    'inventory', (select jsonb_build_object('value', coalesce(sum(stock_value), 0), 'products', count(*), 'units', coalesce(sum(stock), 0))
                  from public.product_stock where is_active),
    'recent_sales', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]') from (
        select s.id, s.number, s.total, s.payment_method, s.status, s.created_at, s.item_count,
               (select concat_ws(' ', st.first_name, st.last_name) from public.staff st where st.user_id = s.user_id) as cashier
        from public.sale s order by s.created_at desc limit 8) x)
  );
end $$;
