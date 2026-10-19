-- =============================================================================
-- Agregar productos a un ingreso ya registrado (los que se olvidaron al registrarlo).
-- inv_receive_invoice con purchase_id suma las líneas a ese ingreso en vez de crear otro:
-- usa su proveedor, no revisa la factura duplicada y suma el total.
-- El id del envío (p.id) queda en purchase_item.client_id: reintentar no duplica las líneas.
-- =============================================================================

alter table public.purchase_item add column client_id uuid;
create index purchase_item_client_idx on public.purchase_item (client_id) where client_id is not null;

-- Cuándo entró cada línea (las agregadas después tienen otra fecha que el ingreso).
alter table public.purchase_item add column created_at timestamptz;
update public.purchase_item pi set created_at = pu.created_at from public.purchase pu where pu.id = pi.purchase_id;
alter table public.purchase_item alter column created_at set default now(), alter column created_at set not null;

-- p: { purchase_id?, client_id?, supplier_id?, invoice_number?, note?, items: [{ product_id, lot_number, expiry_date, units, cost_unit }] }
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
  v_client uuid := nullif(p->>'client_id', '')::uuid;
begin
  if jsonb_array_length(coalesce(p->'items', '[]')) = 0 then raise exception 'El ingreso no tiene productos'; end if;
  if nullif(p->>'purchase_id', '') is not null then
    select * into v_purchase from public.purchase where id = (p->>'purchase_id')::uuid for update;
    if v_purchase.id is null then raise exception 'Ingreso no encontrado'; end if;
  else
    insert into public.purchase (supplier_id, invoice_number, note, user_id, created_at)
    values (nullif(p->>'supplier_id', '')::uuid, nullif(trim(p->>'invoice_number'), ''), nullif(trim(p->>'note'), ''), p_user, p_created)
    returning * into v_purchase;
  end if;

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

    insert into public.purchase_item (purchase_id, product_id, lot_id, lot_number, expiry_date, units, cost_unit, client_id, created_at)
    values (v_purchase.id, v_prod.id, v_lot.id, v_lot.lot_number, v_lot.expiry_date, v_units, v_cost, v_client, p_created);
    perform internal.record_movement(v_prod.id, v_lot.id, 'compra', v_units, v_purchase.id, 'Ingreso #' || v_purchase.number, p_user, p_created);
    v_total := v_total + round(v_units * v_cost, 2);
  end loop;

  update public.purchase set total = total + v_total where id = v_purchase.id returning * into v_purchase;
  return v_purchase;
end $$;

-- p: { id?, purchase_id?, supplier_id? | supplier: { name, ruc? }, invoice_number?, note?, allow_duplicate?,
--      items: [{ product_id? | new_product: { name, generic_name?, form, presentation?, laboratory?, barcode?, units_per_pack, price_unit, price_pack?,
--                                units_per_blister?, price_blister? },
--                supplier_code?, lot_number, expiry_date, units, cost_unit }] }
-- Con purchase_id las líneas se agregan a ese ingreso (el proveedor y la factura son los suyos).
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
  v_target uuid := nullif(p->>'purchase_id', '')::uuid;
  v_purchase public.purchase;
begin
  perform internal.assert_staff();
  if v_target is not null then
    select * into v_purchase from public.purchase where id = v_target;
    if v_purchase.id is null then raise exception 'Ingreso no encontrado'; end if;
    -- Reintento: estas líneas ya se agregaron.
    if v_client is not null and exists (select 1 from public.purchase_item where purchase_id = v_target and client_id = v_client) then
      return v_purchase;
    end if;
    v_sup := v_purchase.supplier_id;
  else
    -- Reintento desde el teléfono: el ingreso ya se registró.
    if v_client is not null then
      select * into v_purchase from public.purchase where client_id = v_client;
      if v_purchase.id is not null then return v_purchase; end if;
    end if;
  end if;
  if jsonb_array_length(coalesce(p->'items', '[]')) = 0 then raise exception 'El ingreso no tiene productos'; end if;

  if v_target is null and v_sup is null and v_sup_name is not null then
    select id into v_sup from public.supplier
     where (v_sup_ruc is not null and regexp_replace(coalesce(ruc, ''), '\D', '', 'g') = v_sup_ruc)
        or internal.norm(name) = internal.norm(v_sup_name)
     limit 1;
    if v_sup is null then
      insert into public.supplier (name, ruc) values (v_sup_name, v_sup_ruc) returning id into v_sup;
    end if;
  end if;

  if v_target is null and v_sup is not null and internal.invoice_key(p->>'invoice_number') is not null and not coalesce((p->>'allow_duplicate')::boolean, false) then
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
    jsonb_build_object('purchase_id', v_target, 'client_id', v_client, 'supplier_id', v_sup, 'invoice_number', p->'invoice_number',
                       'note', p->'note', 'items', v_items), auth.uid());
  if v_target is null and v_client is not null then
    update public.purchase set client_id = v_client where id = v_purchase.id returning * into v_purchase;
  end if;
  return v_purchase;
end $$;
