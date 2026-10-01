-- =============================================================================
-- Venta web idempotente.
-- La web genera el id de la venta al abrir el cobro (p.id) y lo reusa en cada reintento.
-- Si se cortó internet después de que el servidor registró la venta, o el cajero pulsó
-- "Cobrar" dos veces, el reintento devuelve la misma venta en vez de cobrar de nuevo.
-- Sin p.id (versiones anteriores de la web) se comporta como antes.
-- =============================================================================
create or replace function public.pos_create_sale(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_session uuid;
  v_sale public.sale;
begin
  perform internal.assert_staff();
  if v_id is not null then
    -- Dos envíos simultáneos del mismo cobro: el segundo espera al primero y devuelve su venta.
    perform pg_advisory_xact_lock(hashtext('sale:' || v_id::text));
    if exists (select 1 from public.sale where id = v_id) then
      if not exists (select 1 from public.sale where id = v_id and user_id = auth.uid()) then
        raise exception 'No autorizado' using errcode = '42501';
      end if;
      return internal.sale_json(v_id);
    end if;
  end if;
  -- share: impide que la caja se cierre a mitad de la venta.
  select id into v_session from public.cash_session where user_id = auth.uid() and closed_at is null for share;
  if v_session is null then raise exception 'Tu caja está cerrada. Ábrela antes de vender'; end if;
  v_sale := internal.create_sale(p, auth.uid(), v_session);
  return internal.sale_json(v_sale.id);
end $$;
