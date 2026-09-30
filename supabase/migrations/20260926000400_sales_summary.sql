-- =============================================================================
-- Resumen de ventas de un periodo (cantidad y total), calculado en el servidor.
-- El historial de la app carga las ventas por páginas; los totales no pueden
-- depender de cuántas páginas se hayan cargado.
-- =============================================================================
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
  );
end $$;

revoke execute on function public.pos_sales_summary(timestamptz, timestamptz) from anon;
