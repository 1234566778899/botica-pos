-- =============================================================================
-- Ingresos desde la app Android: el teléfono manda un id propio (client_id) para que
-- reintentar después de un corte de conexión no registre el ingreso dos veces.
-- =============================================================================

alter table public.purchase add column client_id uuid unique;

-- p: { id?, supplier_id? | supplier: { name, ruc? }, invoice_number?, note?, allow_duplicate?,
--      items: [{ product_id? | new_product: { name, generic_name?, form, presentation?, laboratory?, units_per_pack, price_unit, price_pack? },
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
      -- Si ya existe con el mismo nombre (o se creó en otra línea de esta factura), se usa ese.
      select id into v_prod from public.product where internal.norm(name) = internal.norm(trim(v_np->>'name')) order by is_active desc limit 1;
      if v_prod is null then
        insert into public.product (name, generic_name, form, presentation, laboratory, units_per_pack, sell_by_unit, price_unit, price_pack)
        values (upper(trim(v_np->>'name')), nullif(trim(v_np->>'generic_name'), ''),
                coalesce(nullif(v_np->>'form', ''), 'otro')::public.dosage_form, nullif(trim(v_np->>'presentation'), ''),
                nullif(upper(trim(v_np->>'laboratory')), ''), greatest(coalesce(nullif(v_np->>'units_per_pack', '')::int, 1), 1), true,
                (v_np->>'price_unit')::numeric, nullif(nullif(v_np->>'price_pack', '')::numeric, 0))
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

