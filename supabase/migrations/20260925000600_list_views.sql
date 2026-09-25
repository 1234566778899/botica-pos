-- =============================================================================
-- Vistas para las listas de la app, con el nombre del usuario que hizo cada operación.
-- Corren con los permisos del dueño (para leer staff), así que filtran por internal.is_staff().
-- =============================================================================
create view public.sale_list as
select s.*, nullif(concat_ws(' ', st.first_name, st.last_name), '') as cashier
from public.sale s left join public.staff st on st.user_id = s.user_id
where internal.is_staff();

create view public.purchase_list as
select pu.*, su.name as supplier_name, nullif(concat_ws(' ', st.first_name, st.last_name), '') as user_name,
       (select count(*) from public.purchase_item pi where pi.purchase_id = pu.id) as item_count,
       (select coalesce(sum(units), 0) from public.purchase_item pi where pi.purchase_id = pu.id) as units
from public.purchase pu
left join public.supplier su on su.id = pu.supplier_id
left join public.staff st on st.user_id = pu.user_id
where internal.is_staff();

create view public.movement_list as
select m.*, p.name as product_name, p.concentration, p.units_per_pack, l.lot_number, l.expiry_date,
       nullif(concat_ws(' ', st.first_name, st.last_name), '') as user_name
from public.stock_movement m
join public.product p on p.id = m.product_id
left join public.lot l on l.id = m.lot_id
left join public.staff st on st.user_id = m.user_id
where internal.is_staff();

create view public.cash_session_list as
select cs.*, nullif(concat_ws(' ', st.first_name, st.last_name), '') as cashier,
       (select count(*) from public.sale s where s.cash_session_id = cs.id and s.status = 'completada') as sales_count,
       (select coalesce(sum(total), 0) from public.sale s where s.cash_session_id = cs.id and s.status = 'completada') as sales_total
from public.cash_session cs left join public.staff st on st.user_id = cs.user_id
where internal.is_admin() or cs.user_id = auth.uid();

revoke all on public.sale_list, public.purchase_list, public.movement_list, public.cash_session_list from anon;
