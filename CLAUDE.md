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
- **Caja por usuario**: cada usuario abre su propio `cash_session` con su fondo, vende en él y lo cierra (índice único por `user_id` entre los abiertos); puede haber varios turnos abiertos a la vez. `closed_by` = quien cerró. `internal.open_session()` devuelve el turno abierto del usuario actual. (Entre el 29 y el 30/09/2026 la caja fue única; esos turnos pueden tener ventas de varios usuarios.)
- **Precios con IGV incluido** (18 %, configurable en `business`). En el ticket el total se separa en op. gravada + IGV.
- **Fechas en hora de Lima.** En SQL usa `internal.today()` y `created_at at time zone 'America/Lima'`, nunca `current_date`, porque Supabase corre en UTC. En el front usa `todayLima()`. Perú es UTC−5 todo el año.
- **Roles** (`staff.role`):
  - `cajero`: vende, ve **solo sus propias ventas** (RLS de `sale`, `sale_list`, `pos_sale`, `pos_sales_summary`), abre y cierra la caja y registra ingresos.
  - `admin`: además ve el panel y la utilidad, edita productos, anula ventas, ajusta lotes y gestiona usuarios.
  - Alta de usuarios: el primer usuario ejecuta `bootstrap_owner`; los demás piden acceso con `request_access` y un admin los aprueba en Configuración → Usuarios.

## Reglas de código

- Toda escritura con lógica va por RPC `security definer` que valida el rol (`internal.assert_staff` / `assert_admin`):
  - `pos_create_sale`, `pos_void_sale`
  - `inv_receive_purchase`, `inv_adjust_lot`, `inv_write_off_expired`
  - `inv_match_invoice`, `inv_receive_invoice` (ingreso desde la factura, ver abajo)
  - `inv_create_product`: alta de producto desde la app Android (todo el personal), con stock inicial opcional. Idempotente por el id que genera el teléfono.
  - `cash_open`, `cash_close`
  - `dashboard`
  - `pos_sync_sale`, `cash_sync_open`, `cash_sync_close` (app Android, ver abajo)
  - `customer_save`: todo el personal registra y edita clientes (ver "Clientes").
  - `inv_set_barcode`: todo el personal (también cajeros) puede asignar o quitar **solo** el código de barras de un producto; rechaza códigos que ya tiene otro producto.
- Los precios y el stock de una venta se recalculan en el servidor; nunca confíes en los del cliente.
- Tablas de catálogo (product, category, supplier, customer): el admin las escribe directo, protegido por RLS. Un `UPDATE` o `DELETE` que RLS bloquea **no da error**, solo afecta 0 filas: pide `.select()` y revisa que vuelva la fila (como en `useDeleteCustomer`). Stock, ventas, compras y caja **no** tienen políticas de escritura: solo cambian por los workflows.
- Las vistas `product_stock` y `lot_status` son `security_invoker`. Las vistas `*_list` corren como dueño y filtran con `internal.is_staff()`.
- Supabase activa **pg-safeupdate** en la API: todo `UPDATE`/`DELETE` necesita `WHERE`, también dentro de funciones (la fila única de `business` se actualiza con `where id = true`). El Postgres local de pruebas no lo tiene, así que revisa esto a mano.
- Un cambio de esquema es una **nueva** migración en `supabase/migrations`. No edites las que ya se aplicaron.
- La pantalla de venta (`src/modules/pos`) carga todo el catálogo activo y busca en memoria (`search.ts`) para que sea instantánea. Atajos:
  - Enter agrega el producto y Shift+Enter agrega la caja.
  - F2 va al buscador y F9 cobra.
  - El lector de código de barras escribe el código y manda Enter.
- UI en español de Perú. Montos con `formatMoney` ("S/ 1,259.90") y stock con `formatUnits` ("3 cajas + 12 u.").

## Ingreso desde la factura (foto o PDF)

En Ingresos → Nuevo, **Leer factura** sube una foto o PDF y rellena el ingreso. Todo el personal puede usarlo, también los cajeros, y crear productos nuevos así (decisión del dueño).

- Edge Function `supabase/functions/inv-read-invoice` (Gemini `gemini-3.8-flash`, salida JSON con esquema, `thinkingLevel: low`, ~10 s). Valida la sesión y que sea personal activo; "Verify JWT" está apagado en el dashboard porque la función hace su propia validación. No guarda el archivo.
- La clave de Gemini está en **Vault** (secreto `gemini_api_key`) y solo la lee `service_role` con `public.gemini_api_key()`. Nunca en el front ni en archivos versionados. Para cambiarla: `select vault.update_secret((select id from vault.secrets where name = 'gemini_api_key'), '<nueva>');`
- La CLI de Supabase de esta máquina está en otra cuenta, así que las Edge Functions (`inv-read-invoice` y `customer-lookup`) se despliegan desde el dashboard:
  - Ve a Edge Functions → nombre → Code, pega el contenido de `supabase/functions/<nombre>/index.ts` y pulsa **Deploy updates** (pide confirmación).
  - Desde el navegador automatizado, el editor es Monaco: `monaco.editor.getEditors()[0].getModel().setValue(código)`. Los avisos emergentes del dashboard tapan el botón: ciérralos antes.
  - "Verify JWT" debe quedar apagado en Settings (las dos funciones validan la sesión ellas mismas).
- `inv_match_invoice` empareja cada línea: primero por el código del proveedor ya usado (`supplier_product`), si no por similitud de nombre (`internal.match_products`, castiga si la concentración no coincide). En el front: ≥ 0.7 se enlaza solo, 0.3–0.7 pide confirmar, menos es producto nuevo.
- `inv_receive_invoice` hace todo en una transacción: crea el proveedor (por RUC o nombre) y los productos nuevos, recuerda los códigos del proveedor y llama a `internal.receive_purchase`. Rechaza una factura ya registrada del mismo proveedor (`internal.invoice_key` ignora espacios y guiones) salvo `allow_duplicate`.
- Los precios impresos pueden venir con o sin IGV: se detecta comparando la suma de las líneas con el subtotal. El costo se guarda **sin IGV** (la botica recupera el crédito fiscal). Vencimiento "07/2029" = último día del mes.
- Si la caja de la factura no coincide con la del catálogo (`units_per_pack`), la línea se registra en unidades y se avisa.

## Clientes

Pantalla **Clientes** (web `/clientes`; en la app, Ventas → Clientes). Todo el personal, también los cajeros, ve la lista, registra y edita clientes y ve su historial de compras completo, incluidas las ventas de otros cajeros (decisión del dueño). Eliminar un cliente es solo para el admin; sus ventas conservan el nombre y el documento.

- `customer`: documento (DNI, RUC, CE, PAS; único), nombre, teléfono, correo, dirección y notas (sin datos de salud). La vista `customer_list` suma las compras completadas. `customer_sales(id)` da el historial con sus productos.
- **En la venta solo se eligen clientes registrados** (búsqueda en memoria por DNI/RUC o nombre). Si no está, "Registrar cliente nuevo" abre la ficha con el documento escrito. La venta envía `customer.id`, y `sale.customer_name` y `customer_doc` guardan los datos de ese momento para el ticket. Si el id no existe (versiones antiguas o un cliente aún no sincronizado), `internal.create_sale` busca por documento o lo registra.
- Al borrar un cliente en la web no se recarga su ficha (volvería vacía y mostraría "Cliente no encontrado"): se quita de la lista y se navega a `/clientes`. En TanStack Query, si el `onSuccess` del hook devuelve la promesa de `invalidateQueries`, la mutación la espera, y el `onSuccess` de `mutate()` no se ejecuta si el componente ya se desmontó.
- `customer_save(p)`: valida igual que el front, es idempotente por `id` y rechaza un documento repetido. La excepción: si el cliente que ya existe no tiene datos de contacto, se completa ese. Con `sync: true` (cola de la app) une los dos clientes y solo completa los datos vacíos.
- **Nombre automático:** con un DNI (8) o RUC (11) completo, la ficha llama a la Edge Function `customer-lookup`. Esta busca primero en `customer` (no gasta consultas) y si no lo encuentra consulta **api.migo.pe**. **No guarda nada**: el cliente se registra al confirmar la ficha. El token de Migo está en Vault (`migo_token`, solo `service_role` con `public.migo_token()`). Si no se encuentra o no hay internet, el nombre se escribe a mano. Solo reemplaza un nombre vacío o el que puso la búsqueda anterior.

## App Android (`android/`)

Caja y ventas sin conexión: Kotlin + Jetpack Compose + Room (SQLite) + WorkManager + supabase-kt 3.8. AGP 9.1 con Kotlin integrado, compileSdk 36 (no subas el BOM de Compose a 2026.08+: pide SDK 37).

```bash
cd android && JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew :app:assembleDebug
```

- **`android/` está en `.gitignore`**: la app solo existe en esta máquina (no se sube con los commits).
- APK para instalar: `cp android/app/build/outputs/apk/debug/app-debug.apk BoticaPOS-1.0-AAAAMMDD.apk` en la raíz del proyecto (los `*.apk` están en `.gitignore`). La release firmada (`botica-release.jks` + `keystore.properties`) no se usa desde el 26/09.
- `android/local.properties` (fuera de git) lleva `sdk.dir`, `supabase.url` y `supabase.key` (solo la publishable key).
- **Local primero.** Cada venta y cada turno se guardan en Room con un uuid generado en el teléfono y luego se suben (`data/sync/SyncManager.kt`): aperturas → ventas → cierres → bajar catálogo, stock y turno actual. Las RPC son idempotentes por id: reintentar nunca duplica.
- Con internet la venta se envía con `strict: true` y el servidor la valida como en la web (si la rechaza, no se guarda). Sin internet queda pendiente; al subirla el servidor no la rechaza por falta de stock ni por producto desactivado: la registra y anota la diferencia en `sale.sync_notes`. El precio cobrado sin conexión solo se respeta si el producto cambió después de que el teléfono bajó el catálogo (`catalog_at`).
- Stock disponible en el teléfono = stock descargado − unidades de ventas con `applied = false` − carrito. `applied` pasa a true cuando se descarga un catálogo que ya las incluye.
- Si el usuario ya tenía su caja abierta (por ejemplo en la web), `cash_sync_open` devuelve ese turno y la app lo adopta (`cash_session.serverId`).
- Pantallas: Vender, Inventario (Productos | Ingresos), Ventas (Ventas | Clientes; el historial combina las ventas del servidor y las del teléfono por subir) y Caja, con barra inferior. En Inventario el botón ⊕ abre: Registrar ingreso, Leer factura y Nuevo producto; la ficha del producto tiene el atajo "Registrar ingreso".
- **Ingresos** (`ui/receive/`): pantalla completa (Dialog) con escáner continuo (cada código suma una caja), búsqueda y lectura de factura (foto con la cámara vía FileProvider `${applicationId}.files`, o foto/PDF del teléfono). Usa las mismas RPC que la web (`inv_match_invoice`, `inv_receive_invoice`) y la Edge Function; esta se llama con `HttpURLConnection` (90 s) porque el cliente de Supabase corta a los 15 s. El ingreso lleva un `id` del teléfono (`purchase.client_id`): reintentar no lo duplica. Necesita internet. Lote vacío = `S/L`. Un código desconocido ofrece crear el producto (sin stock inicial) y se agrega al ingreso.
- **Alta de productos** (`ui/products/NewProductSheet.kt`): botón + en Productos, "Crear producto nuevo" al escanear un código que no existe o al no encontrar una búsqueda. Necesita internet (no hay cola sin conexión). El stock inicial es un lote (`INICIAL` si no se escribe) con vencimiento MM/AAAA = último día del mes. El producto entra a Room al instante (`ProductStockDto.toEntity()`).
- Escáner propio con CameraX + ML Kit con el modelo **incluido** (`ui/components/Scanner.kt`): funciona sin internet desde la instalación. No uses el lector de Play Services (`play-services-code-scanner`): descarga su módulo la primera vez y sin internet no abre. En Vender el escáner es continuo (modo lector); en Productos lee un código y cierra.
- Códigos registrados sin conexión van a la tabla local `barcode_change` y se aplican al catálogo local al instante; `replaceCatalog` los vuelve a aplicar mientras sigan pendientes.
- **Clientes sin conexión:** la tabla local `customer` es la copia de `customer_list` más los cambios pendientes (`state`). Un cliente nuevo lleva un uuid generado en el teléfono.
  - Con internet se guarda de una vez con `customer_save` (`data/CustomerRepository.kt`). Sin internet queda en la cola, que sube **antes** que las ventas.
  - Si el servidor lo unió a otro cliente con el mismo documento, `CustomerDao.saveSynced` borra el local y mueve sus ventas (`sale.customerId`) al id del servidor.
  - El historial de compras de la ficha necesita internet.
- Room está en la versión 3: un cambio de esquema necesita una `Migration` (nunca `fallbackToDestructiveMigration`, borraría ventas sin subir).
