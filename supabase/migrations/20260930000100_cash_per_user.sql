-- =============================================================================
-- Vuelve la caja por usuario: cada uno abre su propio turno con su fondo, vende en él
-- y lo cierra. Puede haber varios turnos abiertos a la vez (uno por usuario).
-- Se mantiene: closed_by (quien cerró) y que el cajero solo ve sus propias ventas.
-- =============================================================================

drop index public.cash_session_single_open_idx;
create unique index cash_session_open_idx on public.cash_session (user_id) where closed_at is null;

-- Turno abierto del usuario actual (null si su caja está cerrada).
create or replace function internal.open_session() returns uuid language sql stable security definer set search_path = public as $$
  select id from public.cash_session where user_id = auth.uid() and closed_at is null limit 1
$$;

-- Quién ve un turno: el admin, quien lo abrió o cerró y quien vendió en él.
create or replace function internal.can_see_session(p_session uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select internal.is_admin() or exists (
    select 1 from public.cash_session cs
     where cs.id = p_session and internal.is_staff()
       and (cs.user_id = auth.uid() or cs.closed_by = auth.uid()
            or exists (select 1 from public.sale s where s.cash_session_id = cs.id and s.user_id = auth.uid())))
$$;

-- -----------------------------------------------------------------------------
-- Caja (web)
-- -----------------------------------------------------------------------------
create or replace function public.cash_open(p_amount numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  perform internal.assert_staff();
  perform pg_advisory_xact_lock(hashtext('cash_session_open:' || auth.uid()::text));
  if internal.open_session() is not null then raise exception 'Ya tienes la caja abierta'; end if;
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
  update public.cash_session
     set closed_at = now(), closed_by = auth.uid(), expected_cash = v_expected,
         counted_cash = coalesce(p_counted, 0), note = nullif(trim(p_note), '')
   where id = v;
  return internal.cash_summary(v);
end $$;

-- -----------------------------------------------------------------------------
-- Venta (web): va al turno abierto de quien vende.
-- -----------------------------------------------------------------------------
create or replace function public.pos_create_sale(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_session uuid;
  v_sale public.sale;
begin
  perform internal.assert_staff();
  -- share: impide que la caja se cierre a mitad de la venta.
  select id into v_session from public.cash_session where user_id = auth.uid() and closed_at is null for share;
  if v_session is null then raise exception 'Tu caja está cerrada. Ábrela antes de vender'; end if;
  v_sale := internal.create_sale(p, auth.uid(), v_session);
  return internal.sale_json(v_sale.id);
end $$;

-- -----------------------------------------------------------------------------
-- App Android
-- -----------------------------------------------------------------------------
-- Con conexión (strict) la venta solo entra en un turno abierto del propio usuario.
-- Sin conexión se acepta cualquier turno existente: un teléfono pudo adoptar el turno
-- de otro usuario mientras la caja era única, y esas ventas no deben quedar atascadas.
create or replace function public.pos_sync_sale(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_session uuid := nullif(p->>'cash_session_id', '')::uuid;
  v_created timestamptz := least(coalesce(nullif(p->>'created_at', '')::timestamptz, now()), now());
  v_strict boolean := coalesce((p->>'strict')::boolean, false);
  v_cs public.cash_session;
begin
  perform internal.assert_staff();
  if v_id is null then raise exception 'Falta el id de la venta'; end if;
  -- Reintento: la venta ya llegó antes.
  if exists (select 1 from public.sale where id = v_id) then
    if not exists (select 1 from public.sale where id = v_id and user_id = auth.uid()) then raise exception 'No autorizado' using errcode = '42501'; end if;
    return internal.sale_json(v_id);
  end if;
  select * into v_cs from public.cash_session where id = v_session for share;
  if v_cs.id is null then raise exception 'El turno de caja de esta venta no existe en el servidor'; end if;
  if v_strict and v_cs.user_id <> auth.uid() then raise exception 'Este turno de caja es de otro usuario'; end if;
  if v_strict and v_cs.closed_at is not null then raise exception 'La caja está cerrada'; end if;

  perform internal.create_sale(p, auth.uid(), v_session, v_created, not v_strict);
  update public.sale set synced_at = now() where id = v_id;
  return internal.sale_json(v_id);
end $$;

-- Abre (o reconoce) el turno. Si el usuario ya tenía uno abierto (por ejemplo, en la web),
-- la app lo adopta: devuelve ese turno y el teléfono usa su id.
create or replace function public.cash_sync_open(p_id uuid, p_amount numeric, p_opened_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  perform internal.assert_staff();
  perform pg_advisory_xact_lock(hashtext('cash_session_open:' || auth.uid()::text));
  if exists (select 1 from public.cash_session where id = p_id and user_id = auth.uid()) then return internal.cash_summary(p_id); end if;
  v := internal.open_session();
  if v is not null then return internal.cash_summary(v); end if;
  insert into public.cash_session (id, user_id, opened_at, opening_amount)
  values (p_id, auth.uid(), least(coalesce(p_opened_at, now()), now()), greatest(coalesce(p_amount, 0), 0));
  return internal.cash_summary(p_id);
end $$;

-- Cierra el turno con la hora real del cierre. Si ya estaba cerrado (reintento) o es de otro
-- usuario (adoptado mientras la caja era única), no lo toca y devuelve cómo quedó.
create or replace function public.cash_sync_close(p_session uuid, p_counted numeric, p_note text default null, p_closed_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.cash_session;
  v_expected numeric;
begin
  perform internal.assert_staff();
  select * into v from public.cash_session where id = p_session for update;
  if v.id is null then raise exception 'Turno de caja no encontrado'; end if;
  if v.closed_at is not null or v.user_id <> auth.uid() then return internal.cash_summary(v.id); end if;
  v_expected := (internal.cash_summary(v.id)->>'cash_expected')::numeric;
  update public.cash_session
     set closed_at = least(greatest(coalesce(p_closed_at, now()), v.opened_at), now()), closed_by = auth.uid(),
         expected_cash = v_expected, counted_cash = coalesce(p_counted, 0), note = nullif(trim(p_note), '')
   where id = v.id;
  return internal.cash_summary(v.id);
end $$;
