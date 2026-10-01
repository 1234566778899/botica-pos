-- El número de factura se compara sin espacios, guiones ni otros signos: "F001 679322" = "F001-679322".
create or replace function internal.invoice_key(t text) returns text language sql immutable parallel safe as $$
  select nullif(upper(regexp_replace(coalesce(t, ''), '[^A-Za-z0-9]', '', 'g')), '')
$$;
