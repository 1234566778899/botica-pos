-- =============================================================================
-- 1. Una sola caja para toda la botica.
--    Antes cada usuario tenía su propio turno: si un cajero cerraba, el admin
--    seguía viendo abierto el suyo. Ahora hay como máximo un turno abierto;
--    cualquiera del personal vende en él y cualquiera puede cerrarlo.
--    cash_session.user_id = quien abrió; closed_by = quien cerró.
-- 2. Historial de ventas: el cajero solo ve las ventas que hizo él; el admin, todas.
-- =============================================================================

alter table public.cash_session add column closed_by uuid references auth.users (id) on delete set null;
update public.cash_session set closed_by = user_id where closed_at is not null and closed_by is null;

-- Si hoy hay varios turnos abiertos, se queda abierto el más reciente y los demás se cierran
-- con su efectivo esperado (sin conteo: el conteo real lo hará quien cierre la caja).
update public.cash_session cs
   set closed_at = now(), closed_by = cs.user_id,
       expected_cash = (internal.cash_summary(cs.id)->>'cash_expected')::numeric,
       note = 'Cerrado automáticamente al unificar la caja (había otro turno abierto).'
 where cs.closed_at is null
   and cs.id <> (select id from public.cash_session where closed_at is null order by opened_at desc limit 1);

drop index public.cash_session_open_idx;
create unique index cash_session_single_open_idx on public.cash_session ((true)) where closed_at is null;

-- Turno abierto de la botica (null si la caja está cerrada).
create or replace function internal.open_session() returns uuid language sql stable security definer set search_path = public as $$
  select id from public.cash_session where closed_at is null limit 1
$$;

-- Quién ve un turno: el admin, quien lo abrió o cerró, quien vendió en él, y todos mientras está abierto.
create or replace function internal.can_see_session(p_session uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select internal.is_admin() or exists (
    select 1 from public.cash_session cs
     where cs.id = p_session and internal.is_staff()
       and (cs.closed_at is null or cs.user_id = auth.uid() or cs.closed_by = auth.uid()
            or exists (select 1 from public.sale s where s.cash_session_id = cs.id and s.user_id = auth.uid())))
$$;

create or replace function internal.cash_summary(p_session uuid) returns jsonb language sql stable as $$
  select to_jsonb(cs) || jsonb_build_object(
    'cashier', (select concat_ws(' ', st.first_name, st.last_name) from public.staff st where st.user_id = cs.user_id),
    'closed_by_name', (select concat_ws(' ', st.first_name, st.last_name) from public.staff st where st.user_id = cs.closed_by),
    'sales_count', (select count(*) from public.sale where cash_session_id = cs.id and status = 'completada'),
    'sales_total', (select coalesce(sum(total), 0) from public.sale where cash_session_id = cs.id and status = 'completada'),
    'voided_count', (select count(*) from public.sale where cash_session_id = cs.id and status = 'anulada'),
    'by_method', (select coalesce(jsonb_object_agg(m, t), '{}') from (
        select payment_method::text as m, sum(total) as t from public.sale where cash_session_id = cs.id and status = 'completada' group by 1) x),
    'cash_expected', cs.opening_amount + (select coalesce(sum(total), 0) from public.sale
                                          where cash_session_id = cs.id and status = 'completada' and payment_method = 'efectivo'))
  from public.cash_session cs where cs.id = p_session
$$;

-- -----------------------------------------------------------------------------
-- Caja (web)
-- -----------------------------------------------------------------------------
create or replace function public.cash_current() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  perform internal.assert_staff();
  v := internal.open_session();
  return case when v is null then null else internal.cash_summary(v) end;
end $$;

create or replace function public.cash_open(p_amount numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  perform internal.assert_staff();
  perform pg_advisory_xact_lock(hashtext('cash_session_open'));
  v := internal.open_session();
  if v is not null then
    raise exception 'La caja ya está abierta (la abrió %)', coalesce(internal.cash_summary(v)->>'cashier', 'otro usuario');
  end if;
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
  select id into v from public.cash_session where closed_at is null for update;
  if v is null then raise exception 'La caja ya está cerrada'; end if;
  v_expected := (internal.cash_summary(v)->>'cash_expected')::numeric;
  update public.cash_session
     set closed_at = now(), closed_by = auth.uid(), expected_cash = v_expected,
         counted_cash = coalesce(p_counted, 0), note = nullif(trim(p_note), '')
   where id = v;
  return internal.cash_summary(v);
end $$;

create or replace function public.cash_session_detail(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform internal.assert_staff();
  if not internal.can_see_session(p_session) then raise exception 'No autorizado' using errcode = '42501'; end if;
  return internal.cash_summary(p_session);
end $$;

-- -----------------------------------------------------------------------------
-- Venta (web): va al turno abierto de la botica, sea quien sea que lo abrió.
-- -----------------------------------------------------------------------------
create or replace function public.pos_create_sale(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_session uuid;
  v_sale public.sale;
begin
  perform internal.assert_staff();
  -- share: impide que la caja se cierre a mitad de la venta.
  select id into v_session from public.cash_session where closed_at is null for share;
  if v_session is null then raise exception 'La caja está cerrada. Ábrela antes de vender'; end if;
  v_sale := internal.create_sale(p, auth.uid(), v_session);
  return internal.sale_json(v_sale.id);
end $$;

-- El detalle de una venta: el cajero solo las suyas.
create or replace function public.pos_sale(p_sale uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform internal.assert_staff();
  if not internal.is_admin() and not exists (select 1 from public.sale where id = p_sale and user_id = auth.uid()) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  return internal.sale_json(p_sale);
end $$;

create or replace function public.pos_sales_summary(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform internal.assert_staff();
  return (
    select jsonb_build_object(
      'count', count(*) filter (where status = 'completada'),
      'total', coalesce(sum(total) filter (where status = 'completada'), 0),
      'voided', count(*) filter (where status = 'anulada'))
    from public.sale
    where created_at >= p_from and created_at < p_to
      and (internal.is_admin() or user_id = auth.uid())
  );
end $$;

-- -----------------------------------------------------------------------------
-- App Android
-- -----------------------------------------------------------------------------
create or replace function public.pos_sync_sale(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_session uuid := nullif(p->>'cash_session_id', '')::uuid;
  v_created timestamptz := least(coalesce(nullif(p->>'created_at', '')::timestamptz, now()), now());
  v_strict boolean := coalesce((p->>'strict')::boolean, false);
  v_closed timestamptz;
begin
  perform internal.assert_staff();
  if v_id is null then raise exception 'Falta el id de la venta'; end if;
  -- Reintento: la venta ya llegó antes.
  if exists (select 1 from public.sale where id = v_id) then
    if not exists (select 1 from public.sale where id = v_id and user_id = auth.uid()) then raise exception 'No autorizado' using errcode = '42501'; end if;
    return internal.sale_json(v_id);
  end if;
  select closed_at into v_closed from public.cash_session where id = v_session for share;
  if not found then raise exception 'El turno de caja de esta venta no existe en el servidor'; end if;
  if v_strict and v_closed is not null then raise exception 'La caja está cerrada'; end if;

  perform internal.create_sale(p, auth.uid(), v_session, v_created, not v_strict);
  update public.sale set synced_at = now() where id = v_id;
  return internal.sale_json(v_id);
end $$;

-- Abre (o reconoce) el turno. Si la caja ya está abierta (por la web o por otro usuario),
-- la app la adopta: devuelve ese turno y el teléfono usa su id.
create or replace function public.cash_sync_open(p_id uuid, p_amount numeric, p_opened_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  perform internal.assert_staff();
  perform pg_advisory_xact_lock(hashtext('cash_session_open'));
  if exists (select 1 from public.cash_session where id = p_id) then return internal.cash_summary(p_id); end if;
  v := internal.open_session();
  if v is not null then return internal.cash_summary(v); end if;
  insert into public.cash_session (id, user_id, opened_at, opening_amount)
  values (p_id, auth.uid(), least(coalesce(p_opened_at, now()), now()), greatest(coalesce(p_amount, 0), 0));
  return internal.cash_summary(p_id);
end $$;

-- Cierra el turno con la hora real del cierre. Si ya estaba cerrado (reintento, o lo cerró
-- otro usuario), no lo toca y devuelve cómo quedó.
create or replace function public.cash_sync_close(p_session uuid, p_counted numeric, p_note text default null, p_closed_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.cash_session;
  v_expected numeric;
begin
  perform internal.assert_staff();
  select * into v from public.cash_session where id = p_session for update;
  if v.id is null then raise exception 'Turno de caja no encontrado'; end if;
  if v.closed_at is not null then return internal.cash_summary(v.id); end if;
  v_expected := (internal.cash_summary(v.id)->>'cash_expected')::numeric;
  update public.cash_session
     set closed_at = least(greatest(coalesce(p_closed_at, now()), v.opened_at), now()), closed_by = auth.uid(),
         expected_cash = v_expected, counted_cash = coalesce(p_counted, 0), note = nullif(trim(p_note), '')
   where id = v.id;
  return internal.cash_summary(v.id);
end $$;

-- -----------------------------------------------------------------------------
-- Lectura (RLS y vistas)
-- -----------------------------------------------------------------------------
drop policy own_or_admin on public.cash_session;
create policy staff_visible on public.cash_session for select to authenticated using (internal.can_see_session(id));

drop policy staff_read on public.sale;
drop policy staff_read on public.sale_item;
drop policy staff_read on public.sale_item_lot;
create policy own_or_admin on public.sale for select to authenticated
  using (internal.is_admin() or (internal.is_staff() and user_id = auth.uid()));
create policy own_or_admin on public.sale_item for select to authenticated
  using (exists (select 1 from public.sale s where s.id = sale_id));
create policy own_or_admin on public.sale_item_lot for select to authenticated
  using (exists (select 1 from public.sale_item i where i.id = sale_item_id));

drop view public.sale_list;
create view public.sale_list as
select s.*, nullif(concat_ws(' ', st.first_name, st.last_name), '') as cashier
from public.sale s left join public.staff st on st.user_id = s.user_id
where internal.is_staff() and (internal.is_admin() or s.user_id = auth.uid());

drop view public.cash_session_list;
create view public.cash_session_list as
select cs.*, nullif(concat_ws(' ', st.first_name, st.last_name), '') as cashier,
       nullif(concat_ws(' ', sc.first_name, sc.last_name), '') as closed_by_name,
       (select count(*) from public.sale s where s.cash_session_id = cs.id and s.status = 'completada') as sales_count,
       (select coalesce(sum(total), 0) from public.sale s where s.cash_session_id = cs.id and s.status = 'completada') as sales_total
from public.cash_session cs
left join public.staff st on st.user_id = cs.user_id
left join public.staff sc on sc.user_id = cs.closed_by
where internal.can_see_session(cs.id);

revoke all on public.sale_list, public.cash_session_list from anon;
