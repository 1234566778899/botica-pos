-- =============================================================================
-- Alta de productos desde la app Android (todo el personal, como el ingreso desde la factura).
-- El teléfono genera el id: reintentar no duplica. Opcionalmente registra el stock inicial
-- (un lote) con el ingreso de siempre.
-- =============================================================================

-- p: { id, name, generic_name?, concentration?, form?, presentation?, laboratory?, category_id?, barcode?,
--      units_per_pack, sell_by_unit?, price_unit, price_pack?, min_stock?,
--      stock?: { lot_number?, expiry_date, units, cost_unit? } }
create or replace function public.inv_create_product(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := coalesce(nullif(p->>'id', '')::uuid, gen_random_uuid());
  v_barcode text := nullif(regexp_replace(coalesce(p->>'barcode', ''), '\s', '', 'g'), '');
  v_name text := nullif(upper(trim(p->>'name')), '');
  v_pack int := coalesce(nullif(p->>'units_per_pack', '')::int, 1);
  v_price numeric := nullif(p->>'price_unit', '')::numeric;
  v_stock jsonb := p->'stock';
  v_units int := coalesce(nullif(p->'stock'->>'units', '')::int, 0);
  v_other text;
begin
  perform internal.assert_staff();
  -- Reintento: ya se creó.
  if exists (select 1 from public.product where id = v_id) then
    return (select to_jsonb(ps) from public.product_stock ps where ps.id = v_id);
  end if;

  if v_name is null then raise exception 'Escribe el nombre del producto'; end if;
  if v_pack < 1 then raise exception 'Las unidades por caja deben ser 1 o más'; end if;
  if coalesce(v_price, 0) <= 0 then raise exception 'Indica el precio de venta por unidad'; end if;
  if v_barcode is not null then
    if length(v_barcode) > 64 then raise exception 'Código de barras inválido'; end if;
    select name into v_other from public.product where barcode = v_barcode;
    if v_other is not null then raise exception 'El código % ya está asignado a %', v_barcode, v_other; end if;
  end if;
  if v_units < 0 then raise exception 'Cantidad inválida'; end if;
  if v_units > 0 and nullif(v_stock->>'expiry_date', '') is null then raise exception 'Indica el vencimiento del stock inicial'; end if;

  insert into public.product (id, name, generic_name, concentration, form, presentation, laboratory, category_id, barcode,
                              units_per_pack, sell_by_unit, price_unit, price_pack, min_stock)
  values (v_id, v_name, nullif(trim(p->>'generic_name'), ''), nullif(trim(p->>'concentration'), ''),
          coalesce(nullif(p->>'form', ''), 'otro')::public.dosage_form, nullif(trim(p->>'presentation'), ''),
          nullif(upper(trim(p->>'laboratory')), ''), nullif(p->>'category_id', '')::uuid, v_barcode,
          v_pack, v_pack = 1 or coalesce((p->>'sell_by_unit')::boolean, true), v_price,
          nullif(nullif(p->>'price_pack', '')::numeric, 0), greatest(coalesce(nullif(p->>'min_stock', '')::int, 0), 0));

  if v_units > 0 then
    perform internal.receive_purchase(jsonb_build_object(
      'note', 'Stock inicial (alta desde la app)',
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', v_id,
        'lot_number', coalesce(nullif(trim(v_stock->>'lot_number'), ''), 'INICIAL'),
        'expiry_date', v_stock->>'expiry_date',
        'units', v_units,
        'cost_unit', coalesce(nullif(v_stock->>'cost_unit', '')::numeric, 0)))), auth.uid());
  end if;

  return (select to_jsonb(ps) from public.product_stock ps where ps.id = v_id);
end $$;

revoke execute on function public.inv_create_product(jsonb) from anon;
