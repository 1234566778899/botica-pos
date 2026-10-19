-- =============================================================================
-- Nombre del cliente por DNI/RUC: Decolecta (api.decolecta.com) pasa a ser el proveedor
-- principal de la Edge Function customer-lookup; Migo queda de respaldo.
-- El token de Decolecta está en Vault (secreto 'decolecta_token') y solo lo lee service_role.
-- =============================================================================

create or replace function public.decolecta_token() returns text
language sql stable security definer set search_path = public as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'decolecta_token' limit 1
$$;
revoke all on function public.decolecta_token() from public, anon, authenticated;
grant execute on function public.decolecta_token() to service_role;
