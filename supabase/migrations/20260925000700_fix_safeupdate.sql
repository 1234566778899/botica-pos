-- Supabase activa pg-safeupdate para las peticiones de la API: todo UPDATE/DELETE necesita WHERE.
-- bootstrap_owner actualizaba la fila única de business sin WHERE ("UPDATE requires a WHERE clause").
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
    update public.business set name = trim(p_business_name) where id = true;
  end if;
  return v;
end $$;
