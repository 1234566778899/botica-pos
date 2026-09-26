-- =============================================================================
-- Registrar códigos de barras desde la app (cámara del teléfono)
--
-- Editar productos es solo para administradores (RLS). Asignar el código de barras
-- es una tarea de mostrador: el cajero escanea la caja y lo guarda, así después
-- se vende escaneando con la cámara. Esta RPC deja a todo el personal cambiar
-- SOLO el código de barras, y avisa si el código ya es de otro producto.
-- =============================================================================
create or replace function public.inv_set_barcode(p_product uuid, p_barcode text) returns public.product
language plpgsql security definer set search_path = public as $$
declare
  v public.product;
  v_code text := nullif(regexp_replace(coalesce(p_barcode, ''), '\s', '', 'g'), '');
  v_other text;
begin
  perform internal.assert_staff();
  if v_code is not null then
    if length(v_code) > 64 then raise exception 'Código de barras inválido'; end if;
    select name into v_other from public.product where barcode = v_code and id <> p_product;
    if v_other is not null then raise exception 'El código % ya está asignado a %', v_code, v_other; end if;
  end if;
  update public.product set barcode = v_code where id = p_product returning * into v;
  if v.id is null then raise exception 'Producto no encontrado'; end if;
  return v;
end $$;

revoke execute on function public.inv_set_barcode(uuid, text) from anon;
