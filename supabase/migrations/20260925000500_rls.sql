-- =============================================================================
-- Seguridad (RLS)
--   personal activo: lee todo lo operativo
--   administrador: además edita catálogo, proveedores, negocio y personal
--   stock, ventas, compras y caja solo cambian por los workflows (security definer)
-- =============================================================================
do $$
declare t text;
begin
  foreach t in array array['business', 'staff', 'category', 'supplier', 'product', 'customer', 'lot', 'purchase', 'purchase_item',
                           'stock_movement', 'cash_session', 'sale', 'sale_item', 'sale_item_lot'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;

  -- Lectura para el personal activo
  foreach t in array array['business', 'category', 'supplier', 'product', 'customer', 'lot', 'purchase', 'purchase_item',
                           'stock_movement', 'sale', 'sale_item', 'sale_item_lot'] loop
    execute format('create policy staff_read on public.%I for select to authenticated using (internal.is_staff())', t);
  end loop;

  -- Escritura directa solo para administradores (catálogo y datos maestros)
  foreach t in array array['category', 'supplier', 'product', 'customer'] loop
    execute format('create policy admin_write on public.%I for all to authenticated using (internal.is_admin()) with check (internal.is_admin())', t);
  end loop;
end $$;

create policy admin_update on public.business for update to authenticated using (internal.is_admin()) with check (internal.is_admin());

-- Personal: cada uno ve su perfil; el admin ve y gestiona a todos (no puede quitarse a sí mismo el rol).
create policy self_read on public.staff for select to authenticated using (user_id = auth.uid() or internal.is_admin());
create policy admin_manage on public.staff for update to authenticated
  using (internal.is_admin() and user_id <> auth.uid()) with check (internal.is_admin());
create policy admin_remove on public.staff for delete to authenticated using (internal.is_admin() and user_id <> auth.uid());

-- Caja: cada cajero ve sus turnos; el admin todos.
create policy own_or_admin on public.cash_session for select to authenticated using (user_id = auth.uid() or internal.is_admin());

grant execute on function public.has_owner() to anon, authenticated;
revoke execute on function public.dashboard(date, date) from anon;

insert into public.business (id) values (true) on conflict do nothing;
