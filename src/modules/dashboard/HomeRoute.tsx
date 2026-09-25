import { Navigate } from "react-router";
import { useIsAdmin } from "@/modules/auth/AuthProvider";
import { DashboardPage } from "./DashboardPage";

/** Inicio: el administrador ve el panel; el cajero va directo a vender. */
export function HomeRoute() {
  return useIsAdmin() ? <DashboardPage /> : <Navigate to="/vender" replace />;
}
