# Botica POS

Punto de venta e inventario para boticas (Perú): venta rápida con buscador por nombre, principio activo o código de barras; stock por lotes con vencimiento; caja por turnos; panel con ventas del día, productos por vencer y stock bajo.

## Puesta en marcha

1. Aplica la base de datos en tu proyecto de Supabase:
   ```bash
   supabase db push --db-url "postgresql://postgres.<ref>:<password>@<pooler>:5432/postgres"
   psql "<misma conexión>" -f supabase/seed.sql   # opcional: datos de ejemplo
   ```
2. Copia `.env.example` a `.env.local` con la URL y la **publishable key** del proyecto.
3. `npm install && npm run dev` → http://localhost:5181
4. Crea tu cuenta ("Crear cuenta"). El primer usuario configura la botica y queda como administrador.
   - Si Supabase pide confirmar el correo, agrega `http://localhost:5181` en **Authentication → URL Configuration → Redirect URLs**, o desactiva "Confirm email" mientras desarrollas.
5. El personal crea su cuenta, pide acceso y el administrador lo aprueba en **Configuración → Usuarios**.

## Despliegue en Vercel

1. En Vercel: **Add New → Project → Import** el repositorio `botica-pos`. Se detecta Vite; el build es `npm run build` y la salida `dist` (ya definidos en `vercel.json`, que además redirige todas las rutas a `index.html` para que funcionen /vender, /ventas, etc. al recargar).
2. **Settings → Environment Variables** (Production y Preview):

   | Variable | Valor |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | la *publishable key* (nunca la secret ni la service_role: todo lo que empieza con `VITE_` queda visible en el navegador) |

3. **Supabase → Authentication → URL Configuration**: pon el dominio de Vercel como *Site URL* y agrégalo en *Redirect URLs* (`https://<tu-proyecto>.vercel.app/**`), para que funcionen la confirmación de correo y la recuperación de contraseña.
4. Deploy. Las variables `VITE_*` se leen al compilar: si las cambias, vuelve a desplegar.

## Módulos

| Pantalla | Qué hace |
|---|---|
| **Vender** | Buscador instantáneo, genéricos equivalentes, venta por unidad o caja, cobro con vuelto (F9), ticket de 80 mm. |
| **Inicio** (admin) | Ventas, número de ventas, ticket promedio, utilidad, ventas por hora o día, métodos de pago, por vencer, vencidos, stock bajo, más vendidos. |
| **Ventas** | Historial con filtros por fecha, pago y estado; detalle, reimpresión y anulación (admin). |
| **Caja** | Apertura con fondo, cierre con conteo del efectivo y diferencia; historial de turnos. |
| **Productos** | Catálogo con stock, vencimiento, precios por unidad y caja, margen; lotes y ajustes. |
| **Ingresos** | Mercadería recibida por lote y vencimiento (en cajas o unidades) con costo promedio. |
| **Vencimientos** | Lotes por vencer, próximos 30 días y vencidos; baja masiva de vencidos. |
| **Kardex** (admin) | Todos los movimientos de stock con su saldo. |
| **Configuración** (admin) | Datos del ticket, IGV, aviso de vencimiento, usuarios, categorías y proveedores. |

## App Android (caja y ventas sin internet)

En `android/` hay una app nativa (Kotlin + Jetpack Compose) con **Vender** y **Caja** que sigue funcionando si se va el internet: guarda todo en el teléfono (SQLite/Room) y lo sube sola al volver la conexión. También se puede sincronizar a mano desde Caja.

1. Aplica la migración `supabase/migrations/20260926000100_offline_sync.sql` (`supabase db push`).
2. Crea `android/local.properties`:
   ```properties
   sdk.dir=/ruta/al/Android/sdk
   supabase.url=https://<ref>.supabase.co
   supabase.key=<publishable key>
   ```
3. Abre `android/` en Android Studio y ejecuta, o `./gradlew :app:assembleDebug`.

Tiene cuatro pestañas: **Vender**, **Productos** (detalle con stock, lotes y el código de barras; se registra escaneando la caja con la cámara), **Ventas** (historial con detalle) y **Caja**. Una vez registrados los códigos, se vende escaneando con la cámara del celular, sin lector láser. Se entra con la misma cuenta de la web (la primera vez necesita internet). Busca por nombre, principio activo o código, y escanea con la cámara o con un lector USB/Bluetooth. Cobra en efectivo (con vuelto), Yape, Plin, tarjeta o transferencia, y comparte el ticket.
