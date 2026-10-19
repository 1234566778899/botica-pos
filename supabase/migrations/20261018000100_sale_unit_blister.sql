-- Venta por blister (ver 20261018000200_blister.sql). Va sola: un valor nuevo de un enum
-- no se puede usar en la misma transacción en que se agrega.
alter type public.sale_unit add value if not exists 'blister' before 'caja';
