import { createBrowserRouter, Navigate, Outlet } from "react-router";
import { AppFrame } from "@/components/layout/AppFrame";
import { EmptyState } from "@/components/ui";
import { AccessGate } from "@/modules/auth/AccessGate";
import { useIsAdmin } from "@/modules/auth/AuthProvider";

const lazy = (load: () => Promise<Record<string, React.ComponentType>>, name: string) => async () => ({ Component: (await load())[name] });

/** Solo administradores; el cajero vuelve a la pantalla de venta. */
function AdminOnly() {
  return useIsAdmin() ? <Outlet /> : <Navigate to="/vender" replace />;
}


export const router = createBrowserRouter([
  {
    element: (
      <AccessGate>
        <AppFrame />
      </AccessGate>
    ),
    children: [
      { index: true, lazy: lazy(() => import("@/modules/dashboard/HomeRoute"), "HomeRoute") },
      { path: "vender", lazy: lazy(() => import("@/modules/pos/PosPage"), "PosPage") },
      { path: "ventas", lazy: lazy(() => import("@/modules/sales/SalesPage"), "SalesPage") },
      { path: "ventas/:id", lazy: lazy(() => import("@/modules/sales/SaleDetailPage"), "SaleDetailPage") },
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
      { path: "*", element: <EmptyState title="Página no encontrada" description="Revisa la dirección o vuelve al inicio." /> },
    ],
  },
]);
