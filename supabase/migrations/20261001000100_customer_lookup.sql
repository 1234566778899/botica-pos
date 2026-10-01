-- =============================================================================
-- Autocompletar el nombre del cliente por DNI o RUC (Edge Function customer-lookup).
-- El token de Migo está en Vault (secreto 'migo_token') y solo lo lee service_role.
-- =============================================================================

create or replace function public.migo_token() returns text
language sql stable security definer set search_path = public as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'migo_token' limit 1
$$;
revoke all on function public.migo_token() from public, anon, authenticated;
grant execute on function public.migo_token() to service_role;
