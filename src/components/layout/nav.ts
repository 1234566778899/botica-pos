import { CalendarClock, ClipboardList, Contact, Home, Landmark, PackagePlus, Pill, Receipt, ScanBarcode, Settings, Store, Tags, Truck, Users, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Role } from "@/lib/types";

export type NavItem = { label: string; to: string; icon: LucideIcon; end?: boolean; roles?: Role[] };

/** Menú principal. `roles` limita quién lo ve (por defecto, todos). */
export const mainNav: NavItem[] = [
  { label: "Vender", to: "/vender", icon: ScanBarcode },
  { label: "Inicio", to: "/", icon: Home, end: true, roles: ["admin"] },
  { label: "Ventas", to: "/ventas", icon: Receipt },
  { label: "Clientes", to: "/clientes", icon: Contact },
  { label: "Caja", to: "/caja", icon: Wallet },
  { label: "Productos", to: "/productos", icon: Pill },
  { label: "Ingresos", to: "/ingresos", icon: PackagePlus },
  { label: "Vencimientos", to: "/vencimientos", icon: CalendarClock },
  { label: "Kardex", to: "/kardex", icon: ClipboardList, roles: ["admin"] },
];

export const settingsNav: NavItem[] = [
  { label: "Botica", to: "/configuracion", icon: Store, end: true },
  { label: "Usuarios", to: "/configuracion/usuarios", icon: Users },
  { label: "Categorías", to: "/configuracion/categorias", icon: Tags },
  { label: "Proveedores", to: "/configuracion/proveedores", icon: Truck },
];

export const settingsIcon = Settings;
export const cashIcon = Landmark;
