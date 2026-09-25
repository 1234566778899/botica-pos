import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, LogOut, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { cn, MenuList, Popover } from "@/components/ui";
import { fullName } from "@/lib/format";
import { supabase, unwrap } from "@/lib/supabase";
import type { Business } from "@/lib/types";
import { useAuth, useStaff } from "@/modules/auth/AuthProvider";
import { mainNav, settingsIcon as SettingsIcon, settingsNav, type NavItem } from "./nav";

export function useBusiness() {
  return useQuery({ queryKey: ["business"], queryFn: async () => unwrap(await supabase.from("business").select("*").single()) as Business, staleTime: 5 * 60_000 });
}

const itemClass = (active: boolean, compact?: boolean) =>
  cn("flex h-[30px] items-center gap-2 rounded-[8px] text-[13px] font-[450] transition-colors",
     compact ? "w-9 justify-center" : "pr-1 pl-2",
     active ? "bg-frame-active font-[550] text-white" : "text-frame-text hover:bg-frame-hover hover:text-white");

function NavSection({ items, compact }: { items: NavItem[]; compact?: boolean }) {
  const staff = useStaff();
  return (
    <ul className="space-y-px">
      {items.filter((i) => !i.roles || i.roles.includes(staff.role)).map((item) => (
        <li key={item.to}>
          <NavLink to={item.to} end={item.end} title={compact ? item.label : undefined} className={({ isActive }) => itemClass(isActive, compact)}>
            <item.icon className="size-4 shrink-0" strokeWidth={1.8} />
            {!compact && item.label}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

function Sidebar({ compact, onNavigate }: { compact?: boolean; onNavigate?: () => void }) {
  const { pathname } = useLocation();
  const staff = useStaff();
  const { signOut } = useAuth();
  const { data: business } = useBusiness();
  const inSettings = pathname.startsWith("/configuracion");
  const name = fullName(staff.first_name, staff.last_name) || staff.email;

  return (
    <nav aria-label="Principal" className={cn("flex h-full flex-col pt-3 pb-3", compact ? "items-center px-2" : "px-3")} onClick={(e) => (e.target as HTMLElement).closest("a") && onNavigate?.()}>
      {inSettings ? (
        <>
          <Link to="/" className="mb-3 flex h-8 items-center gap-1.5 px-1 text-[14px] font-[650] text-white">
            <ChevronLeft className="size-4" /> Configuración
          </Link>
          <NavSection items={settingsNav} />
        </>
      ) : (
        <>
          <Link to="/" className={cn("mb-4 flex h-8 items-center gap-2", compact ? "justify-center" : "px-1")} title={business?.name}>
            <img src="/logo.png" alt="" className="size-7 shrink-0 rounded-[7px] bg-white p-0.5" />
            {!compact && <span className="truncate text-[14px] font-[650] text-white">{business?.name ?? "Botica"}</span>}
          </Link>
          <NavSection items={mainNav} compact={compact} />
        </>
      )}

      <div className="mt-auto space-y-px pt-4">
        {!inSettings && staff.role === "admin" && (
          <NavLink to="/configuracion" title={compact ? "Configuración" : undefined} className={({ isActive }) => itemClass(isActive, compact)}>
            <SettingsIcon className="size-4" strokeWidth={1.8} /> {!compact && "Configuración"}
          </NavLink>
        )}
        <Popover
          align="start"
          placement="top"
          trigger={({ toggle }) => (
            <button type="button" onClick={toggle} title={compact ? name : undefined} className={cn("flex h-9 items-center gap-2 rounded-[8px] text-left hover:bg-frame-hover", compact ? "w-9 justify-center" : "w-full px-1.5")}>
              <span className="grid size-6 shrink-0 place-items-center rounded-[6px] bg-brand text-[11px] font-[650] text-white">{name.slice(0, 2).toUpperCase()}</span>
              {!compact && (
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-[550] text-white">{name}</span>
                  <span className="block truncate text-[11px] text-white/55">{staff.role === "admin" ? "Administrador" : "Cajero"}</span>
                </span>
              )}
            </button>
          )}
        >
          {(close) => <MenuList close={close} items={[{ label: "Cerrar sesión", icon: LogOut, onClick: signOut }]} />}
        </Popover>
      </div>
    </nav>
  );
}

/** Marco: barra lateral oscura + panel blanco redondeado. En "Vender" la barra se reduce a íconos. */
export function AppFrame() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { pathname } = useLocation();
  const compact = pathname.startsWith("/vender");
  const { data: business } = useBusiness();
  useEffect(() => setMobileOpen(false), [pathname]);

  return (
    <div className="flex h-full bg-frame">
      <aside className={cn("hidden shrink-0 lg:block", compact ? "w-[56px]" : "w-[220px]")}>
        <Sidebar compact={compact} />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="w-[260px] bg-frame"><Sidebar onNavigate={() => setMobileOpen(false)} /></div>
          <button type="button" aria-label="Cerrar menú" className="flex-1 bg-black/50" onClick={() => setMobileOpen(false)}>
            <X className="ml-3 size-5 text-white" />
          </button>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col lg:py-1 lg:pr-1">
        <div className="flex h-11 items-center gap-2 px-3 lg:hidden">
          <button type="button" aria-label="Abrir menú" onClick={() => setMobileOpen(true)} className="grid size-8 place-items-center rounded-[8px] text-white hover:bg-frame-hover">
            <Menu className="size-5" />
          </button>
          <img src="/logo.png" alt="" className="size-7 rounded-[7px] bg-white p-0.5" />
          <span className="truncate text-[14px] font-[650] text-white">{business?.name ?? "Botica"}</span>
        </div>
        <main className={cn("min-h-0 flex-1 rounded-t-[16px] bg-surface lg:rounded-[16px]", compact ? "overflow-hidden" : "overflow-y-auto")}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
