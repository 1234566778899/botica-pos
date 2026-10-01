-- =============================================================================
-- Ingreso desde la foto o PDF de la factura.
-- 1. La Edge Function inv-read-invoice lee el documento con Gemini. Su clave está en Vault
--    (secreto 'gemini_api_key') y solo la puede leer service_role.
-- 2. inv_match_invoice empareja las líneas con el catálogo: primero por el código del
--    proveedor que ya se usó antes (supplier_product), si no, por similitud de nombre.
-- 3. inv_receive_invoice registra todo en una transacción: crea el proveedor y los
--    productos nuevos, recuerda los códigos del proveedor y hace el ingreso de siempre.
-- Todo el personal puede usarlo (también los cajeros, por decisión del dueño).
-- =============================================================================

create or replace function public.gemini_api_key() returns text
language sql stable security definer set search_path = public as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'gemini_api_key' limit 1
$$;
revoke all on function public.gemini_api_key() from public, anon, authenticated;
grant execute on function public.gemini_api_key() to service_role;

-- Código del producto en el catálogo de cada proveedor → nuestro producto.
create table public.supplier_product (
  supplier_id uuid not null references public.supplier (id) on delete cascade,
  code text not null,
  product_id uuid not null references public.product (id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (supplier_id, code)
);
alter table public.supplier_product enable row level security;
create policy staff_read on public.supplier_product for select to authenticated using (internal.is_staff());

-- Números de un texto ("AMOXI. 500MG+AC. CLAV.125MG" → {125,500}) para no confundir concentraciones.
create or replace function internal.num_tokens(t text) returns text[] language sql immutable parallel safe as $$
  select coalesce(array_agg(distinct (m[1])::numeric::text), '{}')
    from regexp_matches(replace(coalesce(t, ''), ',', '.'), '(\d+(?:\.\d+)?)', 'g') m
$$;

create or replace function internal.invoice_key(t text) returns text language sql immutable parallel safe as $$
  select nullif(upper(regexp_replace(coalesce(t, ''), '\s', '', 'g')), '')
$$;

-- Productos parecidos a una línea de factura (name = nombre limpio, description = texto impreso).
create or replace function internal.match_products(p_name text, p_description text, p_limit int default 3)
returns table (product_id uuid, score real) language sql stable set search_path = public, extensions as $$
  with q as (select internal.norm(p_name) as n, internal.norm(p_description) as d, internal.num_tokens(p_name) as nums)
  select p.id,
         (greatest(similarity(internal.norm(p.name), q.n), similarity(internal.norm(p.name), q.d),
                   similarity(internal.norm(p.name || ' ' || coalesce(p.presentation, '')), q.d))
          * case when cardinality(q.nums) > 0 and cardinality(x.nums) > 0 and not (q.nums <@ x.nums or x.nums <@ q.nums)
                 then 0.4 else 1 end)::real as score
    from public.product p
   cross join q
   cross join lateral (select internal.num_tokens(p.name || ' ' || coalesce(p.concentration, '')) as nums) x
   order by score desc, p.is_active desc
   limit p_limit
$$;

-- p: { supplier_name?, supplier_ruc?, invoice_number?, items: [{ code?, name, description }] }
create or replace function public.inv_match_invoice(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_ruc text := nullif(regexp_replace(coalesce(p->>'supplier_ruc', ''), '\D', '', 'g'), '');
  v_name text := nullif(trim(p->>'supplier_name'), '');
  v_sup public.supplier;
  v_dup jsonb;
begin
  perform internal.assert_staff();
  if v_ruc is not null then
    select * into v_sup from public.supplier where regexp_replace(coalesce(ruc, ''), '\D', '', 'g') = v_ruc limit 1;
  end if;
  if v_sup.id is null and v_name is not null then
    select * into v_sup from public.supplier s
     where similarity(internal.norm(s.name), internal.norm(v_name)) >= 0.45
        or word_similarity(internal.norm(v_name), internal.norm(s.name)) >= 0.8
     order by similarity(internal.norm(s.name), internal.norm(v_name)) desc limit 1;
  end if;

  if internal.invoice_key(p->>'invoice_number') is not null then
    select jsonb_build_object('number', pu.number, 'created_at', pu.created_at) into v_dup
      from public.purchase pu
     where internal.invoice_key(pu.invoice_number) = internal.invoice_key(p->>'invoice_number')
       and (v_sup.id is null or pu.supplier_id = v_sup.id)
     order by pu.created_at desc limit 1;
  end if;

  return jsonb_build_object(
    'supplier', case when v_sup.id is null then null else jsonb_build_object('id', v_sup.id, 'name', v_sup.name) end,
    'duplicate', v_dup,
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'mapped', (select sp.product_id from public.supplier_product sp
                           where sp.supplier_id = v_sup.id and sp.code = nullif(trim(i.value->>'code'), '')),
               'candidates', (select coalesce(jsonb_agg(jsonb_build_object('id', m.product_id, 'score', round(m.score::numeric, 3)) order by m.score desc), '[]')
                                from internal.match_products(i.value->>'name', i.value->>'description') m
                               where m.score >= 0.2))
             order by i.ordinality), '[]')
        from jsonb_array_elements(coalesce(p->'items', '[]')) with ordinality i)
  );
end $$;

-- p: { supplier_id? | supplier: { name, ruc? }, invoice_number?, note?, allow_duplicate?,
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
begin
  perform internal.assert_staff();
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

  return internal.receive_purchase(
    jsonb_build_object('supplier_id', v_sup, 'invoice_number', p->'invoice_number', 'note', p->'note', 'items', v_items), auth.uid());
end $$;

revoke execute on function public.inv_match_invoice(jsonb) from anon;
revoke execute on function public.inv_receive_invoice(jsonb) from anon;
