"""Convierte supabase/data/cuadro.txt (transcripción de CUADRO.pdf) en supabase/data/cuadro.sql.

Cada fila: DESCRIPCIÓN  DD/MM/AAAA  LABORATORIO  CANTIDAD  S/ PRECIO  S/ TOTAL
- PRECIO es el precio al público de la presentación (caja, frasco, tubo…).
- CANTIDAD es el número de presentaciones en stock.
Uso: python3 scripts/import_cuadro.py
"""
import json, math, re, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
ROW = re.compile(r'^(.*) (\d{1,2})/(\d{2})/(\d{4}) (.+) (\d+) S/ ([\d,]+\.\d{2}) S/ ([\d,]+\.\d{2})$')
CONC = re.compile(r'\d+(?:[.,]\d+)?\s*(?:MG|MCG|UG|UI|GR|G|%)(?:\s*/\s*\d*(?:[.,]\d+)?\s*(?:ML|G))?(?:\s*\+\s*\d+(?:[.,]\d+)?\s*(?:MG|MCG|G|UI))*', re.I)
PACK = re.compile(r'X\s*(\d+)\s*(?:/\s*\d+\s*)?(TAB|COMP|GRAG|CAP|AMP|VIAL|OVU|SOB|SACHET|UNID|APLIC|JER)', re.I)
PACKAGING_NOTE = re.compile(r'\d+\s*(SOBR|TAB|OVUL)\w*\s*X\s*\d+', re.I)

FORMS = [  # (patrón, forma) — el primero que coincide
    (r'OVU', 'ovulo'), (r'INH|DOSI', 'inhalador'), (r'COLIRIO|OFT|OTICA|GOT', 'gotas'),
    (r'INY|AMP|VIAL|JER|INJEKTOPAS|BOLSA|INSTAYECT', 'inyectable'), (r'\bGEL\b', 'gel'), (r'UNG\b|UNG\.', 'unguento'),
    (r'CREMA|\bCR\b', 'crema'), (r'SUSP', 'suspension'), (r'JBE|JAB|JARABE', 'jarabe'),
    (r'SOB|SACHET', 'sobre'), (r'CAP', 'capsula'), (r'TAB|COMP(?!LEX)|GRAG', 'tableta'),
    (r'SOL\b|SOL\.|SOLUCION|\d\s*ML', 'solucion'),
]

# Categorías en orden de prioridad: (nombre, color, palabras clave)
CATEGORIES = [
    ('Salud femenina', '#d85a9c', ['OVU', 'VAGIS', 'VAG.', 'MESIGYNA', 'DROKSE', 'NOFERTYL', 'MENSILLE', 'SOLOUNA', 'NORIFAM', 'LEVONORG', 'DAMICOCYN', 'GUVARIX', 'EVITTA', 'MICROGYNON', 'DORITA', 'SELENE', 'DIANE', 'DIXI', 'FLAVIA', 'IDELLE', 'POSULEN', 'PHYTO SOYA', 'BABY TEST']),
    ('Salud sexual', '#8e5bd4', ['SILDENAF', 'SILDEX', 'PIEL ']),
    ('Oftálmicos y óticos', '#2aa7c9', ['FRAMIDEX', 'OTIDOL', 'HUMED', 'FLORIL', 'COLIRIO']),
    ('Antibióticos', '#7b4fd6', ['AMOXI', 'AMPICIL', 'AZITRO', 'ZITROTRIM', 'CEFALEX', 'SEROTOCAF', 'KELEXYN', 'CEFACLOR', 'CEFALOX', 'CEFTRI', 'CEFTREX', 'CEFAGRAM', 'CIPRO', 'CLINDAM', 'CLINLIP', 'DOXICICL', 'LEVOFLOX', 'SULFA', 'DOLATRIM', 'CLAVU', 'VELAMOX', 'AB-BRONCOL']),
    ('Antiparasitarios', '#b0782a', ['ALBENDAZ', 'PARASIT', 'MEBENDAZ', 'SECNIDAZ', 'TINIDAZ', 'METRONIDAZ', 'FLAGYL', 'PARDIL']),
    ('Antimicóticos y dermatológicos', '#c9607a', ['CLOTRIMAZ', 'MICO DERMASAN', 'CANESTEN', 'TERBINAF', 'LAMIDIZOL', 'KETOCONAZ', 'FLUCONAZ', 'FLUCOBAL', 'FLUCODAZOL', 'ACICLOVIR', 'BETAMET', 'PORTIL', 'MUPIROC', 'NEOMICINA', 'ROXTIL', 'BEXADERM']),
    ('Corticoides', '#6b7a8f', ['DEXAMET', 'DEXCORTIL', 'DESAZONA', 'PREDNIS']),
    ('Antialérgicos', '#3fb28a', ['CETIRIZ', 'LORATAD', 'DESLORAT', 'LEVOCETIR', 'CLORFEN', 'CLORFEDAN', 'ALERLIV', 'ALERFREE', 'ALERGILAB', 'RYNA-DEL', 'ERGICO']),
    ('Respiratorio y antigripales', '#4a90d9', ['AMBROXOL', 'SALBUTAM', 'ACTERIL', 'BECLOMET', 'FLUIMEX', 'DEXABRON', 'BRONCOPHAR', 'MUXATIL', 'DR.FLU', 'ANTIGRIP']),
    ('Digestivos', '#e0a030', ['SIMETIC', 'GASEOPLUS', 'OMEPRA', 'ACIPRAL', 'ESOMEPRA', 'ULCEZOLE', 'PANTOPRA', 'GASTROLUD', 'LACTULOSA', 'BISMU', 'MAGNESIA', 'GASTRORAL', '3-GEL', 'HIOSCINA', 'GRAVDAN', 'SILENTIUM', 'BIOGAIA', 'MAGNESOL']),
    ('Analgésicos y antiinflamatorios', '#e25c5c', ['PARACET', 'PANADOL', 'IBUPROF', 'NONPIRON', 'DICLOF', 'NAPROX', 'KETOROL', 'KETOPRO', 'ANALGES', 'MELOXIC', 'ARTRIFLAM', 'CELECOX', 'CELESTAL', 'ETORICOX', 'METAMIZ', 'REPRIMAN', 'FEBRIZOL', 'ANTALGINA', 'DOLO', 'ANALGELUX', 'TOTAL-FLEXX', 'PARADOLO', 'PLIDAN', 'BENALGIN']),
    ('Vitaminas y suplementos', '#f28a2e', ['VITA', 'B-VAT', 'REFORCE', 'BIONTAFER', 'HIDROXOCOBAL', 'ANEURIN', 'WELTONIC', 'ANEMIPLUS', 'OSTEOVIT', 'ORAMIN', 'MEMOVITAL', 'MUCOVIT', 'CERE B', 'INJEKTOPAS', 'GLUCONATO', 'NEONYPOL', 'SORBAMIN']),
    ('Crónicos', '#5a6f8f', ['ATORVAST', 'LESTALID', 'LOSARTAN', 'GEMFIBROZ']),
    ('Otros', '#8a8a8a', []),
]
RX_CATEGORIES = {'Antibióticos'}   # en Perú los antibióticos se venden con receta médica

def clean(s):
    return re.sub(r'\s+', ' ', s).strip(' .-')

# Palabras de forma, vía o empaque que no son parte del principio activo.
NOISE = re.compile(r'\b(JBE|JAB|JARABE|SUSP|SUSPENSION|GOTAS|GOT|CREMA|CR|GEL|INY|I\.M|I\.V|IM/IV/IA|CJA|TABLETAS|TAB|CAPS|CAP|SOL|SOLUCION|FCO|NF|12H|KIDS|NIÑOS|LIB|PROL|DOSIS|INH|OFT|VAG|DERMICA|DE SODIO)\b\.?', re.I)
ABBREV = [(r'\bAMOXI?\.?(?=\s|\+|$)', 'AMOXICILINA'), (r'\bAMOX\b', 'AMOXICILINA'), (r'\bAC\.\s*', 'ACIDO '), (r'\bCLAV(UL)?\.?(?=\s|\+|$)', 'CLAVULANICO'),
          (r'CLAVUNATO POTASIO', 'CLAVULANATO'), (r'METRONIZADOL', 'METRONIDAZOL'), (r'^SULFA\.?(?=\s|\+|$)', 'SULFAMETOXAZOL'), (r'\+\s*TRIMET\.?', '+ TRIMETOPRIMA'),
          (r'\bTRIM(ET)?\.?(?=\s|\+|$)', 'TRIMETOPRIMA'), (r'TRIMETOTRIMA', 'TRIMETOPRIMA'), (r'\bPARAC\.?(?=\s|\+|$)', 'PARACETAMOL'), (r'\bIBUPROF\.?(?=\s|\+|$)', 'IBUPROFENO')]

def clean_generic(g):
    if not g:
        return None
    for pat, rep in ABBREV:
        g = re.sub(pat, rep, g)
    g = NOISE.sub(' ', g)
    g = re.sub(r'\s*\+\s*', ' + ', g)
    return clean(g) or None

def parse(line):
    m = ROW.match(line.strip())
    desc, d, mth, y, lab, qty, price = m.group(1), m.group(2), m.group(3), m.group(4), m.group(5), int(m.group(6)), float(m.group(7).replace(',', ''))
    parens = re.findall(r'\(([^()]*)\)', desc)
    base = clean(re.sub(r'\([^()]*\)', ' ', desc))

    # Principio activo: el paréntesis que no es nota de empaque ni marca
    generic = None
    for p in parens:
        t = clean(p)
        if not t or t in ('F', 'PASCOE') or PACKAGING_NOTE.search(t) or 'ANTICONCEPTIVO' in t or 'TEST DE' in t:
            continue
        generic = clean(re.sub(r'\b(PASCOE)\b', '', CONC.sub('', t)).replace(' +', '+').replace('+ ', '+'))

    # Presentación desde la primera "X <número>" (p. ej. "X 100 TAB", "5MLX 10 AMP")
    pos = None
    for mx in re.finditer(r'X\s*\d', base):
        i = mx.start()
        prev = base[max(0, i - 2):i]
        if i == 0 or base[i - 1] in ' .' or prev in ('ML', 'MG'):
            pos = i
            break
    head = clean(base[:pos]) if pos is not None else base
    presentation = clean(base[pos:]) if pos is not None else None

    cm = CONC.search(head) or (CONC.search(' '.join(parens)) if parens else None)
    concentration = clean(cm.group(0)) if cm else None
    if generic is None:
        # Genérico puro (ej. "PARACETAMOL 500 MG"): el nombre sin la concentración
        generic = clean(CONC.sub('', head).replace('CJA', '')) or None

    form = 'otro'
    for pat, f in FORMS:
        if re.search(pat, desc, re.I):
            form = f
            break

    pk = PACK.search(presentation or '')
    upp = int(pk.group(1)) if pk else 1
    upp = max(upp, 1)

    category = 'Otros'
    hay = f' {desc} '
    for name, _, keys in CATEGORIES:
        if any(k in hay for k in keys):
            category = name
            break

    unit_price = price if upp == 1 else max(0.1, math.ceil(round(price / upp * 10, 6)) / 10)
    units = qty * upp
    return {
        'name': head, 'generic_name': clean_generic(generic), 'concentration': concentration, 'form': form, 'presentation': presentation,
        'laboratory': clean(lab), 'category': category, 'units_per_pack': upp,
        'price_unit': round(unit_price, 2), 'price_pack': round(price, 2) if upp > 1 else None,
        'min_stock': max(1, math.floor(units * 0.2)),
        'requires_prescription': category in RX_CATEGORIES,
        'expiry': f'{y}-{mth}-{int(d):02d}', 'units': units, 'qty': qty,
    }

def q(v):
    if v is None: return 'null'
    if isinstance(v, bool): return 'true' if v else 'false'
    if isinstance(v, (int, float)): return repr(v)
    return "'" + str(v).replace("'", "''") + "'"

rows = [parse(l) for l in (ROOT / 'supabase/data/cuadro.txt').read_text().splitlines() if l.strip()]

# Correcciones revisadas a mano (n.° de fila del cuadro, desde 1).
FIXES = {
    28: {'generic_name': 'BETAMETASONA', 'concentration': '0.05%'},
    71: {'generic_name': 'MELOXICAM'},
    79: {'generic_name': 'METAMIZOL'}, 80: {'generic_name': 'METAMIZOL'},
    96: {'generic_name': 'LACTULOSA', 'concentration': '3.33G/5ML'},
    106: {'generic_name': 'NAPROXENO'},
    113: {'generic_name': 'SUBSALICILATO DE BISMUTO'},
    125: {'generic_name': 'MEDROXIPROGESTERONA + ESTRADIOL', 'concentration': '25MG/5MG'},
    133: {'presentation': 'X 28 TAB', 'units_per_pack': 28, 'name': 'DORITA', 'generic_name': 'ANTICONCEPTIVO ORAL'},
    134: {'generic_name': 'CIPROTERONA + ETINILESTRADIOL'},
    142: {'generic_name': 'CLOTRIMAZOL', 'concentration': '1%'},
    151: {'generic_name': 'CEFTRIAXONA'},
    152: {'generic_name': 'CEFTRIAXONA', 'name': 'CEFTREX 1G', 'presentation': '1 VIAL + 1 AMP'},
    166: {'concentration': '1000UG/1ML'},
    179: {'concentration': '400MG+80MG'}, 181: {'concentration': '200MG+40MG'},
    182: {'concentration': '800MG+160MG'},
    183: {'generic_name': 'NITAZOXANIDA'}, 184: {'generic_name': 'NITAZOXANIDA'},
    186: {'generic_name': 'OTIDOL'}, 188: {'generic_name': 'FLORIL'}, 189: {'generic_name': 'FLORIL'},
    190: {'concentration': '100MG/5ML'}, 198: {'concentration': '100MG/5ML'},
    196: {'generic_name': 'MUPIROCINA', 'concentration': '2%'},
    197: {'generic_name': 'NEOMICINA + BACITRACINA', 'category': 'Antimicóticos y dermatológicos', 'requires_prescription': False},
    202: {'generic_name': 'ACETILCISTEINA'},
    211: {'generic_name': 'PARACETAMOL + FENILEFRINA + CLORFENAMINA', 'form': 'tableta'},
    212: {'category': 'Otros'},
    219: {'generic_name': 'PARACETAMOL'}, 220: {'generic_name': 'PARACETAMOL'},
    227: {'category': 'Otros'}, 228: {'category': 'Otros'},
    229: {'name': 'LECHE DE MAGNESIA PHILLIPS', 'presentation': 'X 120 ML', 'generic_name': 'HIDROXIDO DE MAGNESIO'},
    230: {'generic_name': 'HIDROXIDO DE MAGNESIO'},
    231: {'name': 'LECHE DE MAGNESIA CIRUELA', 'presentation': 'X 120 ML', 'generic_name': 'HIDROXIDO DE MAGNESIO'},
    233: {'name': 'LECHE DE MAGNESIA CEREZA', 'presentation': 'X 120 ML', 'generic_name': 'HIDROXIDO DE MAGNESIO'},
    236: {'generic_name': '3-GEL', 'form': 'sobre'},
    237: {'generic_name': 'SUBSALICILATO DE BISMUTO', 'form': 'tableta'},
    249: {'form': 'solucion'},
}
for n, patch in FIXES.items():
    r = rows[n - 1]
    r.update(patch)
    if 'units_per_pack' in patch:   # recalcular precios y stock
        upp = r['units_per_pack']
        pack = r['price_pack'] or r['price_unit']
        r['price_pack'] = pack
        r['price_unit'] = max(0.1, math.ceil(round(pack / upp * 10, 6)) / 10)
        r['units'] = r['qty'] * upp
        r['min_stock'] = max(1, math.floor(r['units'] * 0.2))
for r in rows:   # "500 MG" y "500MG" deben ser iguales para encontrar equivalentes
    if r['concentration']:
        r['concentration'] = re.sub(r'\s+', '', r['concentration'])

sql = ["-- Generado por scripts/import_cuadro.py a partir de CUADRO.pdf. Borra el catálogo y la operación y carga el inventario inicial.",
       "begin;",
       "truncate public.sale_item_lot, public.sale_item, public.sale, public.cash_session, public.stock_movement,",
       "         public.purchase_item, public.purchase, public.lot, public.product, public.category, public.supplier, public.customer restart identity cascade;",
       "update public.business set ruc = null, address = null, phone = null where id = true;",
       "insert into public.category (name, color, rank) values"]
sql.append(',\n'.join(f"  ({q(n)}, {q(c)}, {i + 1})" for i, (n, c, _) in enumerate(CATEGORIES)) + ';')
sql.append("insert into public.product (code, name, generic_name, concentration, form, presentation, laboratory, category_id, units_per_pack, sell_by_unit, price_unit, price_pack, min_stock, requires_prescription) values")
vals = []
for i, r in enumerate(rows, 1):
    vals.append(f"  ('P{i:04d}', {q(r['name'])}, {q(r['generic_name'])}, {q(r['concentration'])}, '{r['form']}', {q(r['presentation'])}, {q(r['laboratory'])}, "
                f"(select id from public.category where name = {q(r['category'])}), {r['units_per_pack']}, true, {r['price_unit']}, {q(r['price_pack'])}, {r['min_stock']}, {q(r['requires_prescription'])})")
sql.append(',\n'.join(vals) + ';')
items = [{'code': f'P{i:04d}', 'expiry': r['expiry'], 'units': r['units']} for i, r in enumerate(rows, 1)]
sql.append(f"""-- Inventario inicial: un ingreso con un lote por producto (el cuadro no trae número de lote).
select internal.receive_purchase(jsonb_build_object(
  'invoice_number', 'INVENTARIO INICIAL', 'note', 'Carga inicial desde CUADRO.pdf',
  'items', (select jsonb_agg(jsonb_build_object('product_id', p.id, 'lot_number', 'INICIAL', 'expiry_date', i->>'expiry', 'units', (i->>'units')::int, 'cost_unit', 0) order by p.code)
            from jsonb_array_elements({q(json.dumps(items))}::jsonb) i join public.product p on p.code = i->>'code')),
  (select user_id from public.staff where role = 'admin' and is_active order by created_at limit 1));
commit;""")
(ROOT / 'supabase/data/cuadro.sql').write_text('\n'.join(sql) + '\n')
(ROOT / 'supabase/data/cuadro.json').write_text(json.dumps(rows, ensure_ascii=False, indent=1))
print(len(rows), 'productos')
