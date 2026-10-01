import { RefreshCw, TriangleAlert, WifiOff } from "lucide-react";
import { createBrowserRouter, Navigate, Outlet, useRouteError } from "react-router";
import { AppFrame } from "@/components/layout/AppFrame";
import { Button, EmptyState, NotFound } from "@/components/ui";
import { AccessGate } from "@/modules/auth/AccessGate";
import { useIsAdmin } from "@/modules/auth/AuthProvider";

const lazy = (load: () => Promise<Record<string, React.ComponentType>>, name: string) => async () => ({ Component: (await load())[name] });

/** Solo administradores; el cajero vuelve a la pantalla de venta. */
function AdminOnly() {
  return useIsAdmin() ? <Outlet /> : <Navigate to="/vender" replace />;
}

/** Cada pantalla se descarga al abrirla: si se cae la conexión o se publicó una versión nueva, falla la descarga. */
function isLoadError(error: unknown) {
  const msg = error instanceof Error ? error.message : String(error);
  return !navigator.onLine || /dynamically imported module|module script failed|Failed to fetch|Load failed|NetworkError/i.test(msg);
}

/** Error al abrir una pantalla: se muestra dentro del marco (barra lateral) con un botón para recargar. */
function RouteError() {
  const error = useRouteError();
  const reload = <Button variant="primary" icon={RefreshCw} onClick={() => window.location.reload()}>Recargar</Button>;
  return isLoadError(error) ? (
    <EmptyState icon={WifiOff} title="Error de conexión" description="No se pudo cargar esta pantalla. Revisa tu internet y recarga." action={reload} />
  ) : (
    <EmptyState icon={TriangleAlert} title="Algo salió mal" description="Ocurrió un error al mostrar esta pantalla. Recarga para intentarlo de nuevo." action={reload} />
  );
}


export const router = createBrowserRouter([
  {
    element: (
      <AccessGate>
        <AppFrame />
      </AccessGate>
    ),
    children: [
      {
        errorElement: <RouteError />,
        children: [
          { index: true, lazy: lazy(() => import("@/modules/dashboard/HomeRoute"), "HomeRoute") },
          { path: "vender", lazy: lazy(() => import("@/modules/pos/PosPage"), "PosPage") },
          { path: "ventas", lazy: lazy(() => import("@/modules/sales/SalesPage"), "SalesPage") },
          { path: "ventas/:id", lazy: lazy(() => import("@/modules/sales/SaleDetailPage"), "SaleDetailPage") },
          { path: "clientes", lazy: lazy(() => import("@/modules/customers/CustomersPage"), "CustomersPage") },
          { path: "clientes/:id", lazy: lazy(() => import("@/modules/customers/CustomerPage"), "CustomerPage") },
          { path: "caja", lazy: lazy(() => import("@/modules/cash/CashPage"), "CashPage") },
          { path: "productos", lazy: lazy(() => import("@/modules/inventory/ProductsPage"), "ProductsPage") },
          { path: "productos/:id", lazy: lazy(() => import("@/modules/inventory/ProductFormPage"), "ProductFormPage") },
          { path: "ingresos", lazy: lazy(() => import("@/modules/inventory/PurchasesPage"), "PurchasesPage") },
          { path: "ingresos/nuevo", lazy: lazy(() => import("@/modules/inventory/ReceivePage"), "ReceivePage") },
          { path: "vencimientos", lazy: lazy(() => import("@/modules/inventory/ExpiryPage"), "ExpiryPage") },
          {
            Component: AdminOnly,
            children: [
              { path: "kardex", lazy: lazy(() => import("@/modules/inventory/KardexPage"), "KardexPage") },
              { path: "configuracion", lazy: lazy(() => import("@/modules/settings/SettingsPages"), "BusinessSettingsPage") },
              { path: "configuracion/usuarios", lazy: lazy(() => import("@/modules/settings/SettingsPages"), "UsersSettingsPage") },
              { path: "configuracion/categorias", lazy: lazy(() => import("@/modules/settings/SettingsPages"), "CategoriesSettingsPage") },
              { path: "configuracion/proveedores", lazy: lazy(() => import("@/modules/settings/SettingsPages"), "SuppliersSettingsPage") },
            ],
          },
          { path: "*", element: <NotFound /> },
        ],
      },
    ],
  },
]);
