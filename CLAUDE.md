# Botica POS

Punto de venta e inventario para una **botica en Perú**: venta rápida en mostrador, stock por lotes con vencimiento (FEFO), caja por turnos y un panel con ventas del día, productos por vencer y stock bajo.

- Stack: Vite 8 + React 19 + TypeScript + Tailwind 4 + TanStack Query 5 + React Router 8 (modo data, rutas lazy) + Supabase. Iconos lucide, gráficos recharts.
- El diseño viene del panel admin de Cielo Online (`../cielo-online/admin`): mismos componentes propios en `src/components/ui` y tokens en `src/index.css`. No uses Polaris. La marca es el verde farmacia `#0a7a5f`; para series de gráficos usa `#0f9a74`, que pasó el validador de dataviz.
- Las credenciales del proyecto de Supabase (desarrollo) están en `CLAUDE.local.md`, que está en `.gitignore`. Nunca las copies a archivos versionados. La app solo usa la publishable key (`.env.local`).

## Comandos

```bash
npm run dev      # http://localhost:5181 (strictPort; 5180 es el admin de Cielo, 5174 otra app del usuario)
npm run build    # tsc -b && vite build
npm run lint     # oxlint
```

Base de datos (ver `CLAUDE.local.md` para la cadena con contraseña, pooler aws-0-us-west-2):
```bash
supabase db push --db-url '<cadena del pooler>'           # aplica supabase/migrations
psql '<cadena>' -f supabase/data/cuadro.sql              # BORRA todo (menos usuarios y nombre del negocio) y carga el inventario real
psql '<cadena>' -f supabase/seed.sql                      # alternativa: datos demo (solo en base vacía)
```

## Datos reales

- El catálogo inicial viene de `CUADRO.pdf` (252 productos). El PDF y `supabase/data/` son **solo locales** (el repo es público y el usuario no quiere publicar su inventario; están en `.gitignore`). La transcripción está en `supabase/data/cuadro.txt`; `python3 scripts/import_cuadro.py` genera `supabase/data/cuadro.sql` (y `cuadro.json` para revisar). Las correcciones manuales van en `FIXES` dentro del script.
- El precio del cuadro es **precio al público** por presentación (caja o frasco). El precio por unidad es el de la caja dividido y redondeado hacia arriba a S/ 0.10. Todo se vende también por unidad (decisión del usuario).
- El cuadro no trae costo ni número de lote: los lotes se llaman `INICIAL` y el costo es 0, así que la utilidad no es real hasta que se registren ingresos con costo. HUMED GOTAS vence el 31/03/2018 según el PDF (probable error de digitación): figura como vencido.
- Los nombres ya incluyen la concentración ("PARACETAMOL 500 MG"); usa `extraConcentration()` para no repetirla en pantalla.
- Logo: `public/logo.png` (desde `LOGO 120px.jfif`) en la barra lateral, el login y el ticket; `public/favicon.png`.

## Dominio

- **Stock en unidades.** Un producto tiene `units_per_pack` (caja x100). Se vende por unidad o por caja. Si `sell_by_unit = false`, solo se vende la caja completa.
- **Lotes** (`lot`): cada ingreso crea o suma un lote con número y vencimiento.
  - La venta descuenta **FEFO**: primero el lote que vence antes, y nunca un lote vencido.
  - Lo vendible es `lot.expiry_date >= internal.today()`.
- **Kardex** (`stock_movement`): todo cambio de stock queda registrado con el saldo resultante. Tipos: compra, venta, anulación, ajuste, vencido, merma.
- **Precios con IGV incluido** (18 %, configurable en `business`). En el ticket el total se separa en op. gravada + IGV.
- **Fechas en hora de Lima.** En SQL usa `internal.today()` y `created_at at time zone 'America/Lima'`, nunca `current_date`, porque Supabase corre en UTC. En el front usa `todayLima()`. Perú es UTC−5 todo el año.
- **Roles** (`staff.role`):
  - `cajero`: vende, ve ventas, maneja su caja y registra ingresos.
  - `admin`: además ve el panel y la utilidad, edita productos, anula ventas, ajusta lotes y gestiona usuarios.
  - Alta de usuarios: el primer usuario ejecuta `bootstrap_owner`; los demás piden acceso con `request_access` y un admin los aprueba en Configuración → Usuarios.

## Reglas de código

- Toda escritura con lógica va por RPC `security definer` que valida el rol (`internal.assert_staff` / `assert_admin`):
  - `pos_create_sale`, `pos_void_sale`
  - `inv_receive_purchase`, `inv_adjust_lot`, `inv_write_off_expired`
  - `cash_open`, `cash_close`
  - `dashboard`
- Los precios y el stock de una venta se recalculan en el servidor; nunca confíes en los del cliente.
- Tablas de catálogo (product, category, supplier, customer): el admin las escribe directo, protegido por RLS. Stock, ventas, compras y caja **no** tienen políticas de escritura: solo cambian por los workflows.
- Las vistas `product_stock` y `lot_status` son `security_invoker`. Las vistas `*_list` corren como dueño y filtran con `internal.is_staff()`.
- Supabase activa **pg-safeupdate** en la API: todo `UPDATE`/`DELETE` necesita `WHERE`, también dentro de funciones (la fila única de `business` se actualiza con `where id = true`). El Postgres local de pruebas no lo tiene, así que revisa esto a mano.
- Un cambio de esquema es una **nueva** migración en `supabase/migrations`. No edites las que ya se aplicaron.
- La pantalla de venta (`src/modules/pos`) carga todo el catálogo activo y busca en memoria (`search.ts`) para que sea instantánea. Atajos:
  - Enter agrega el producto y Shift+Enter agrega la caja.
  - F2 va al buscador y F9 cobra.
  - El lector de código de barras escribe el código y manda Enter.
- UI en español de Perú. Montos con `formatMoney` ("S/ 1,259.90") y stock con `formatUnits` ("3 cajas + 12 u.").
