-- =============================================================================
-- Datos de ejemplo: botica en Lima con ~50 productos, lotes y 30 días de ventas.
-- Idempotente solo sobre una base vacía (no lo corras dos veces).
-- =============================================================================
update public.business set name = 'Botica Vida Sana', ruc = '20601234567', address = 'Av. Túpac Amaru 1520, Comas, Lima', phone = '01 555 1234';

insert into public.category (name, color, rank) values
  ('Analgésicos', '#e25c5c', 1), ('Antigripales', '#4a90d9', 2), ('Antibióticos', '#8e5bd4', 3), ('Digestivos', '#e0a030', 4),
  ('Antialérgicos', '#3fb28a', 5), ('Vitaminas', '#f28a2e', 6), ('Dermatológicos', '#d85a9c', 7), ('Respiratorio', '#2aa7c9', 8),
  ('Crónicos', '#6b7a8f', 9), ('Cuidado personal', '#5fa35f', 10), ('Primeros auxilios', '#c94a4a', 11), ('Bebés', '#9ab8e8', 12),
  ('Hidratación', '#35b5b5', 13);

insert into public.supplier (name, ruc, phone, contact) values
  ('Droguería Continental', '20512345678', '01 614 2000', 'Rosa Quispe'),
  ('Distribuidora Andina Farma', '20487654321', '01 715 3300', 'Luis Paredes'),
  ('Farmacéutica del Sur', '20555666777', '054 22 1100', 'Carmen Ríos');

-- nombre, genérico, concentración, forma, presentación, laboratorio, categoría, código de barras, unidades/caja,
-- fraccionable, precio unidad, precio caja, costo unidad, stock mínimo, receta
insert into public.product (name, generic_name, concentration, form, presentation, laboratory, category_id, barcode, code,
                            units_per_pack, sell_by_unit, price_unit, price_pack, cost_unit, min_stock, requires_prescription, location)
select t.name, t.generic, t.conc, t.form::public.dosage_form, t.pres, t.lab, (select id from public.category where name = t.cat), t.barcode,
       'P' || lpad(row_number() over ()::text, 4, '0'), t.upp, t.frac, t.pu, t.pp, t.cu, t.minst, t.rx, t.loc
from (values
  ('Panadol', 'Paracetamol', '500 mg', 'tableta', 'Caja x 100 tabletas', 'GSK', 'Analgésicos', '7751234000011', 100, true, 0.60, 50.00, 0.38, 60, false, 'A1'),
  ('Paracetamol', 'Paracetamol', '500 mg', 'tableta', 'Caja x 100 tabletas', 'Genfar', 'Analgésicos', '7751234000028', 100, true, 0.20, 15.00, 0.09, 100, false, 'A1'),
  ('Paracetamol Jarabe', 'Paracetamol', '120 mg/5 mL', 'jarabe', 'Frasco x 60 mL', 'Portugal', 'Analgésicos', '7751234000035', 1, true, 4.50, null, 2.30, 10, false, 'B2'),
  ('Ibuprofeno', 'Ibuprofeno', '400 mg', 'tableta', 'Caja x 100 tabletas', 'Medifarma', 'Analgésicos', '7751234000042', 100, true, 0.30, 25.00, 0.12, 100, false, 'A1'),
  ('Advil', 'Ibuprofeno', '200 mg', 'tableta', 'Caja x 24 tabletas', 'Pfizer', 'Analgésicos', '7751234000059', 24, true, 1.20, 26.00, 0.78, 24, false, 'A1'),
  ('Naproxeno', 'Naproxeno sódico', '550 mg', 'tableta', 'Caja x 100 tabletas', 'Farmindustria', 'Analgésicos', '7751234000066', 100, true, 0.50, 40.00, 0.20, 50, false, 'A2'),
  ('Diclofenaco', 'Diclofenaco sódico', '50 mg', 'tableta', 'Caja x 100 tabletas', 'Genfar', 'Analgésicos', '7751234000073', 100, true, 0.20, 15.00, 0.07, 100, false, 'A2'),
  ('Aspirina', 'Ácido acetilsalicílico', '500 mg', 'tableta', 'Caja x 100 tabletas', 'Bayer', 'Analgésicos', '7751234000080', 100, true, 0.50, 42.00, 0.30, 50, false, 'A2'),
  ('Dolocordralan Extra Fuerte', 'Paracetamol + Cafeína', '500/65 mg', 'tableta', 'Caja x 100 tabletas', 'Hersil', 'Analgésicos', '7751234000097', 100, true, 0.80, 70.00, 0.45, 50, false, 'A2'),
  ('Panadol Antigripal', 'Paracetamol + Fenilefrina + Clorfenamina', '500/5/2 mg', 'tableta', 'Caja x 100 tabletas', 'GSK', 'Antigripales', '7751234000103', 100, true, 1.00, 85.00, 0.62, 50, false, 'A3'),
  ('Antigripal Nf', 'Paracetamol + Fenilefrina + Clorfenamina', '500/5/2 mg', 'tableta', 'Caja x 100 tabletas', 'Portugal', 'Antigripales', '7751234000110', 100, true, 0.50, 40.00, 0.21, 60, false, 'A3'),
  ('Vick VapoRub', 'Mentol + Alcanfor + Eucalipto', '50 g', 'unguento', 'Pote x 50 g', 'P&G', 'Antigripales', '7751234000127', 1, true, 13.50, null, 8.90, 6, false, 'C1'),
  ('Clorfenamina', 'Clorfenamina maleato', '4 mg', 'tableta', 'Caja x 100 tabletas', 'Genfar', 'Antialérgicos', '7751234000134', 100, true, 0.15, 10.00, 0.05, 100, false, 'A4'),
  ('Loratadina', 'Loratadina', '10 mg', 'tableta', 'Caja x 100 tabletas', 'Medifarma', 'Antialérgicos', '7751234000141', 100, true, 0.30, 22.00, 0.10, 60, false, 'A4'),
  ('Cetirizina', 'Cetirizina', '10 mg', 'tableta', 'Caja x 100 tabletas', 'IQFarma', 'Antialérgicos', '7751234000158', 100, true, 0.40, 30.00, 0.14, 60, false, 'A4'),
  ('Amoxicilina', 'Amoxicilina', '500 mg', 'capsula', 'Caja x 100 cápsulas', 'Genfar', 'Antibióticos', '7751234000165', 100, true, 0.60, 50.00, 0.25, 100, true, 'R1'),
  ('Amoxicilina Suspensión', 'Amoxicilina', '250 mg/5 mL', 'suspension', 'Frasco x 60 mL', 'Portugal', 'Antibióticos', '7751234000172', 1, true, 9.50, null, 4.80, 8, true, 'R1'),
  ('Azitromicina', 'Azitromicina', '500 mg', 'tableta', 'Caja x 3 tabletas', 'Medifarma', 'Antibióticos', '7751234000189', 3, false, 4.00, 10.00, 1.60, 12, true, 'R1'),
  ('Ciprofloxacino', 'Ciprofloxacino', '500 mg', 'tableta', 'Caja x 100 tabletas', 'Farmindustria', 'Antibióticos', '7751234000196', 100, true, 0.70, 60.00, 0.28, 60, true, 'R1'),
  ('Cefalexina', 'Cefalexina', '500 mg', 'capsula', 'Caja x 100 cápsulas', 'Genfar', 'Antibióticos', '7751234000202', 100, true, 0.80, 70.00, 0.35, 60, true, 'R2'),
  ('Omeprazol', 'Omeprazol', '20 mg', 'capsula', 'Caja x 100 cápsulas', 'Portugal', 'Digestivos', '7751234000219', 100, true, 0.30, 22.00, 0.09, 100, false, 'A5'),
  ('Ranitidina', 'Ranitidina', '300 mg', 'tableta', 'Caja x 100 tabletas', 'Genfar', 'Digestivos', '7751234000226', 100, true, 0.30, 20.00, 0.10, 50, false, 'A5'),
  ('Bismutol', 'Subsalicilato de bismuto', '87.3 mg/5 mL', 'suspension', 'Frasco x 150 mL', 'Teva', 'Digestivos', '7751234000233', 1, true, 16.90, null, 10.50, 6, false, 'B3'),
  ('Sal de Andrews', 'Bicarbonato de sodio + Ácido cítrico', '5 g', 'sobre', 'Caja x 50 sobres', 'GSK', 'Digestivos', '7751234000240', 50, true, 1.20, 55.00, 0.70, 50, false, 'C2'),
  ('Simeticona Gotas', 'Simeticona', '80 mg/mL', 'gotas', 'Frasco x 15 mL', 'IQFarma', 'Digestivos', '7751234000257', 1, true, 8.50, null, 3.90, 6, false, 'B3'),
  ('Loperamida', 'Loperamida', '2 mg', 'tableta', 'Caja x 100 tabletas', 'Medifarma', 'Digestivos', '7751234000264', 100, true, 0.40, 30.00, 0.13, 40, false, 'A5'),
  ('Vitamina C', 'Ácido ascórbico', '1 g', 'tableta', 'Tubo x 10 efervescentes', 'Bayer', 'Vitaminas', '7751234000271', 10, true, 2.20, 19.00, 1.30, 30, false, 'C3'),
  ('Complejo B', 'Vitaminas B1 + B6 + B12', '100/100/1 mg', 'tableta', 'Caja x 100 tabletas', 'Farmindustria', 'Vitaminas', '7751234000288', 100, true, 0.60, 50.00, 0.24, 50, false, 'C3'),
  ('Ensure Vainilla', 'Suplemento nutricional', '400 g', 'otro', 'Lata x 400 g', 'Abbott', 'Vitaminas', '7751234000295', 1, true, 58.90, null, 46.00, 4, false, 'D1'),
  ('Hirudoid', 'Mucopolisacárido polisulfúrico', '0.3 %', 'crema', 'Tubo x 40 g', 'Bayer', 'Dermatológicos', '7751234000301', 1, true, 32.50, null, 22.80, 4, false, 'C4'),
  ('Clotrimazol Crema', 'Clotrimazol', '1 %', 'crema', 'Tubo x 20 g', 'Genfar', 'Dermatológicos', '7751234000318', 1, true, 5.50, null, 2.10, 8, false, 'C4'),
  ('Betametasona Crema', 'Betametasona', '0.05 %', 'crema', 'Tubo x 20 g', 'Portugal', 'Dermatológicos', '7751234000325', 1, true, 7.90, null, 3.20, 6, true, 'R3'),
  ('Salbutamol Inhalador', 'Salbutamol', '100 mcg/dosis', 'inhalador', 'Frasco x 200 dosis', 'GSK', 'Respiratorio', '7751234000332', 1, true, 24.90, null, 15.50, 6, true, 'R3'),
  ('Ambroxol Jarabe', 'Ambroxol', '30 mg/5 mL', 'jarabe', 'Frasco x 120 mL', 'Medifarma', 'Respiratorio', '7751234000349', 1, true, 7.50, null, 3.10, 8, false, 'B1'),
  ('Abrilar Jarabe', 'Extracto de hoja de hiedra', '35 mg/5 mL', 'jarabe', 'Frasco x 100 mL', 'Bagó', 'Respiratorio', '7751234000356', 1, true, 36.90, null, 25.00, 4, false, 'B1'),
  ('Metformina', 'Metformina', '850 mg', 'tableta', 'Caja x 100 tabletas', 'Genfar', 'Crónicos', '7751234000363', 100, true, 0.30, 22.00, 0.10, 100, true, 'R4'),
  ('Losartán', 'Losartán potásico', '50 mg', 'tableta', 'Caja x 100 tabletas', 'Medifarma', 'Crónicos', '7751234000370', 100, true, 0.40, 30.00, 0.12, 100, true, 'R4'),
  ('Enalapril', 'Enalapril', '10 mg', 'tableta', 'Caja x 100 tabletas', 'Farmindustria', 'Crónicos', '7751234000387', 100, true, 0.20, 15.00, 0.06, 100, true, 'R4'),
  ('Atorvastatina', 'Atorvastatina', '20 mg', 'tableta', 'Caja x 30 tabletas', 'IQFarma', 'Crónicos', '7751234000394', 30, true, 1.20, 30.00, 0.45, 30, true, 'R4'),
  ('Alcohol Medicinal', 'Alcohol etílico', '70°', 'solucion', 'Frasco x 1 L', 'Alkofarma', 'Primeros auxilios', '7751234000400', 1, true, 9.90, null, 5.60, 10, false, 'D2'),
  ('Agua Oxigenada', 'Peróxido de hidrógeno', '10 vol', 'solucion', 'Frasco x 120 mL', 'Alkofarma', 'Primeros auxilios', '7751234000417', 1, true, 2.50, null, 1.10, 10, false, 'D2'),
  ('Gasa Estéril', 'Gasa hidrófila', '10 x 10 cm', 'otro', 'Sobre x 10 unidades', 'Medical', 'Primeros auxilios', '7751234000424', 1, true, 2.00, null, 0.80, 20, false, 'D3'),
  ('Curitas', 'Venditas adhesivas', null, 'otro', 'Caja x 100 unidades', 'Band-Aid', 'Primeros auxilios', '7751234000431', 100, true, 0.20, 16.00, 0.09, 100, false, 'D3'),
  ('Mascarilla Quirúrgica', 'Mascarilla descartable', '3 pliegues', 'otro', 'Caja x 50 unidades', 'Medical', 'Cuidado personal', '7751234000448', 50, true, 0.50, 20.00, 0.18, 50, false, 'D4'),
  ('Preservativos Durex', 'Preservativo de látex', null, 'otro', 'Caja x 3 unidades', 'Durex', 'Cuidado personal', '7751234000455', 3, false, 4.00, 11.00, 6.50, 6, false, 'D4'),
  ('Pañales Huggies Etapa 3', 'Pañal desechable', 'Talla M', 'otro', 'Paquete x 40 unidades', 'Kimberly-Clark', 'Bebés', '7751234000462', 40, false, 1.20, 45.90, 33.00, 3, false, 'E1'),
  ('Hipoglós', 'Óxido de zinc + Vitamina A', '45 g', 'crema', 'Tubo x 45 g', 'Genomma', 'Bebés', '7751234000479', 1, true, 15.90, null, 9.80, 4, false, 'E1'),
  ('Electrolit Naranja', 'Sales de rehidratación oral', '625 mL', 'solucion', 'Botella x 625 mL', 'Pisa', 'Hidratación', '7751234000486', 1, true, 6.50, null, 4.20, 24, false, 'E2'),
  ('Suero Oral', 'Sales de rehidratación oral', '27.9 g', 'sobre', 'Caja x 20 sobres', 'Portugal', 'Hidratación', '7751234000493', 20, true, 1.00, 18.00, 0.45, 20, false, 'E2'),
  ('Dexametasona Inyectable', 'Dexametasona', '4 mg/mL', 'inyectable', 'Ampolla x 2 mL', 'Farmindustria', 'Crónicos', '7751234000509', 1, true, 3.50, null, 1.20, 10, true, 'R5')
) t(name, generic, conc, form, pres, lab, cat, barcode, upp, frac, pu, pp, cu, minst, rx, loc);

-- Stock inicial (hace 40 días): 2 lotes por producto con distintos vencimientos.
do $$
declare
  r record;
  v_supplier uuid[] := array(select id from public.supplier order by name);
  i int := 0;
begin
  perform setseed(0.42);
  for r in select * from public.product order by code loop
    i := i + 1;
    perform internal.receive_purchase(jsonb_build_object(
      'supplier_id', v_supplier[1 + i % 3], 'invoice_number', 'F001-' || lpad((1200 + i)::text, 6, '0'),
      'items', jsonb_build_array(
        jsonb_build_object('product_id', r.id, 'lot_number', 'L' || to_char(now(), 'YY') || lpad((i * 7)::text, 4, '0'),
                           -- algunos lotes vencen pronto o ya vencieron (para el panel)
                           'expiry_date', (internal.today() + case when i % 11 = 0 then -12 when i % 7 = 0 then 18 when i % 5 = 0 then 55 else 200 + (i * 13) % 400 end)::text,
                           'units', greatest(r.units_per_pack, 1) * case when r.units_per_pack >= 50 then 4 when r.units_per_pack = 1 then 40 else 14 end,
                           'cost_unit', r.cost_unit),
        jsonb_build_object('product_id', r.id, 'lot_number', 'L' || to_char(now(), 'YY') || lpad((i * 7 + 3)::text, 4, '0'),
                           'expiry_date', (internal.today() + 420 + (i * 17) % 300)::text,
                           'units', greatest(r.units_per_pack, 1) * case when r.units_per_pack >= 50 then 3 when r.units_per_pack = 1 then 30 else 10 end,
                           'cost_unit', r.cost_unit))
    ), null, now() - interval '40 days');
  end loop;
end $$;

-- 30 días de ventas (más por la tarde; fines de semana algo más).
do $$
declare
  d int;
  n int;
  k int;
  v_items jsonb;
  v_prod record;
  v_method text;
  v_ts timestamptz;
  v_lines int;
  v_popular uuid[] := array(select id from public.product where code in ('P0001','P0002','P0004','P0010','P0011','P0013','P0014','P0021','P0024','P0027','P0040','P0042','P0043','P0044','P0048','P0049'));
begin
  perform setseed(0.17);
  for d in reverse 30..0 loop
    -- Reposición a primera hora de los productos que bajaron del mínimo (salvo unos pocos que se dejan bajos a propósito).
    for v_prod in select p.id, p.units_per_pack, p.cost_unit, p.code from public.product p
                  where internal.sellable_units(p.id) < p.min_stock * 1.5 + 5
                    and p.code not in ('P0016', 'P0036', 'P0033', 'P0044', 'P0048') loop
      perform internal.receive_purchase(jsonb_build_object('supplier_id', (select id from public.supplier order by random() limit 1),
        'invoice_number', 'F001-' || lpad((2000 + d * 50 + floor(random() * 50))::text, 6, '0'),
        'items', jsonb_build_array(jsonb_build_object('product_id', v_prod.id,
          'lot_number', 'R' || lpad((floor(random() * 90000) + 10000)::text, 5, '0'),
          'expiry_date', (internal.today() + 300 + floor(random() * 400)::int)::text,
          'units', greatest(v_prod.units_per_pack, 1) * case when v_prod.units_per_pack >= 50 then 3 when v_prod.units_per_pack = 1 then 24 else 8 end,
          'cost_unit', v_prod.cost_unit))),
        null, ((internal.today() - d)::timestamp + interval '7 hours 30 minutes') at time zone 'America/Lima');
    end loop;
    n := 14 + floor(random() * 18)::int + case when extract(dow from internal.today() - d) in (0, 6) then 8 else 0 end;
    if d = 0 then n := 9 + floor(random() * 6)::int; end if;   -- hoy: el día va a la mitad
    for k in 1..n loop
      v_ts := ((internal.today() - d)::timestamp + make_interval(hours => 8 + floor(power(random(), 0.8) * 13)::int, mins => floor(random() * 60)::int))
              at time zone 'America/Lima';
      if v_ts > now() then v_ts := now() - make_interval(mins => floor(random() * 120)::int); end if;
      v_lines := 1 + floor(random() * random() * 4)::int;
      v_items := '[]';
      for v_prod in
        select p.id, p.units_per_pack, p.sell_by_unit from public.product p
        where p.id = any (case when random() < 0.7 then v_popular else array(select id from public.product) end)
        order by random() limit v_lines
      loop
        v_items := v_items || jsonb_build_object('product_id', v_prod.id,
          'unit', case when v_prod.units_per_pack > 1 and (not v_prod.sell_by_unit or random() < 0.08) then 'caja' else 'unidad' end,
          'quantity', case when v_prod.units_per_pack >= 50 and v_prod.sell_by_unit then 2 + floor(random() * 10)::int else 1 + floor(random() * 1.6)::int end);
      end loop;
      v_method := case when random() < 0.5 then 'efectivo' when random() < 0.7 then 'yape' when random() < 0.5 then 'plin' else 'tarjeta' end;
      begin
        perform internal.create_sale(jsonb_build_object('items', v_items, 'payment', jsonb_build_object('method', v_method)), null, null, v_ts);
      exception when others then null;   -- sin stock suficiente: se omite esa venta
      end;
    end loop;
  end loop;
end $$;

-- Algunos productos con stock bajo para el panel.
update public.product set min_stock = 400 where code in ('P0016', 'P0036');
update public.product set min_stock = 30 where code in ('P0033', 'P0029');
