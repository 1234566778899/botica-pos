-- =============================================================================
-- Núcleo: extensiones, esquema interno, negocio y personal (admin / cajero)
-- =============================================================================
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- Esquema no expuesto por la API: funciones auxiliares.
create schema if not exists internal;
grant usage on schema internal to authenticated, anon;

create or replace function internal.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- Texto normalizado para búsquedas: minúsculas y sin tildes ("Ibuprofeno" = "ibuprofeno").
create or replace function internal.norm(t text) returns text
language sql immutable parallel safe set search_path = extensions, public as $$
  select lower(extensions.unaccent('extensions.unaccent', coalesce(t, '')))
$$;

-- Fecha de hoy en Perú (las ventas "del día" se cuentan en hora de Lima).
create or replace function internal.today() returns date language sql stable as $$
  select (now() at time zone 'America/Lima')::date
$$;

-- -----------------------------------------------------------------------------
-- Negocio (una sola fila): datos del ticket
-- -----------------------------------------------------------------------------
create table public.business (
  id boolean primary key default true check (id),
  name text not null default 'Mi Botica',
  ruc text,
  address text,
  phone text,
  ticket_footer text default '¡Gracias por su compra! Conserve su comprobante.',
  igv_rate numeric(5, 2) not null default 18,
  expiry_warning_days int not null default 90,   -- "por vencer" = vence en los próximos N días
  updated_at timestamptz not null default now()
);
create trigger business_updated_at before update on public.business for each row execute function internal.set_updated_at();

-- -----------------------------------------------------------------------------
-- Personal: cada usuario de Supabase Auth que trabaja en la botica
-- -----------------------------------------------------------------------------
create type public.staff_role as enum ('admin', 'cajero');

create table public.staff (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  first_name text,
  last_name text,
  role public.staff_role not null default 'cajero',
  is_active boolean not null default false,       -- un admin debe aprobar a los nuevos usuarios
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger staff_updated_at before update on public.staff for each row execute function internal.set_updated_at();

create or replace function internal.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid() and is_active)
$$;

create or replace function internal.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid() and is_active and role = 'admin')
$$;

create or replace function internal.assert_staff() returns void language plpgsql stable as $$
begin
  if not internal.is_staff() then raise exception 'No autorizado' using errcode = '42501'; end if;
end $$;

create or replace function internal.assert_admin() returns void language plpgsql stable as $$
begin
  if not internal.is_admin() then raise exception 'No autorizado: solo un administrador puede hacer esto' using errcode = '42501'; end if;
end $$;

-- ¿Ya hay un administrador? (la pantalla de inicio decide si muestra "Configurar botica")
create or replace function public.has_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where role = 'admin' and is_active)
$$;

-- Perfil del usuario que inició sesión (null si no es personal).
create or replace function public.current_staff() returns public.staff
language sql stable security definer set search_path = public as $$
  select * from public.staff where user_id = auth.uid()
$$;

-- El primer usuario configura la botica y queda como administrador.
create or replace function public.bootstrap_owner(p_first_name text, p_last_name text, p_business_name text default null)
returns public.staff language plpgsql security definer set search_path = public as $$
declare v public.staff;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
  if public.has_owner() then raise exception 'La botica ya tiene un administrador'; end if;
  insert into public.staff (user_id, email, first_name, last_name, role, is_active)
  values (auth.uid(), (select email from auth.users where id = auth.uid()), p_first_name, p_last_name, 'admin', true)
  on conflict (user_id) do update set role = 'admin', is_active = true, first_name = excluded.first_name, last_name = excluded.last_name
  returning * into v;
  if nullif(trim(p_business_name), '') is not null then
    update public.business set name = trim(p_business_name);
  end if;
  return v;
end $$;

-- Un usuario nuevo pide acceso; un admin lo activa en Configuración → Usuarios.
create or replace function public.request_access(p_first_name text, p_last_name text)
returns public.staff language plpgsql security definer set search_path = public as $$
declare v public.staff;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
  insert into public.staff (user_id, email, first_name, last_name)
  values (auth.uid(), (select email from auth.users where id = auth.uid()), p_first_name, p_last_name)
  on conflict (user_id) do update set first_name = excluded.first_name, last_name = excluded.last_name
  returning * into v;
  return v;
end $$;
