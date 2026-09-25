import { ChevronLeft } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link } from "react-router";
import { cn } from "./cn";

type Props = {
  /** Icono del módulo en la barra superior (páginas de lista). */
  icon?: LucideIcon;
  /** Título en la barra superior (listas) o título grande (detalle/formulario). */
  title: React.ReactNode;
  /** Migas: [{ label: "Productos", to: "/productos" }] -> muestra botón "atrás". */
  breadcrumbs?: { label: string; to: string }[];
  /** Muestra el título grande (26px) debajo de la barra, como en los formularios. */
  largeTitle?: boolean;
  titleMeta?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  width?: "full" | "default" | "narrow";
  children: React.ReactNode;
};

/** Barra superior del panel (48px) + contenedor de contenido. */
export function Page({ icon: Icon, title, breadcrumbs, largeTitle, titleMeta, subtitle, actions, width = "default", children }: Props) {
  const back = breadcrumbs?.[breadcrumbs.length - 1];
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 rounded-t-[16px] bg-white/90 px-3.5 backdrop-blur">
        {back && (
          <Link to={back.to} aria-label={`Volver a ${back.label}`} className="grid size-7 place-items-center rounded-full shadow-button hover:bg-surface-muted">
            <ChevronLeft className="size-4" strokeWidth={2} />
          </Link>
        )}
        <nav aria-label="Migas" className="flex min-w-0 items-center gap-1.5 text-[13px]">
          {Icon && <Icon className="size-4 shrink-0 text-ink" strokeWidth={1.8} />}
          {breadcrumbs?.map((b) => (
            <span key={b.to} className="flex items-center gap-1.5">
              <Link to={b.to} className="text-ink-secondary hover:text-ink">
                {b.label}
              </Link>
              <span className="text-ink-tertiary">/</span>
            </span>
          ))}
          <span className="truncate font-medium text-ink">{title}</span>
        </nav>
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </header>

      <div className={cn("w-full flex-1 px-4 pb-16", width === "full" ? "pt-1" : "mx-auto pt-3", width === "default" && "max-w-[1120px]", width === "narrow" && "max-w-[800px]")}>
        {largeTitle && (
          <div className="mb-3 flex flex-wrap items-center gap-2.5 px-1">
            <h1 className="page-title">{title}</h1>
            {titleMeta}
          </div>
        )}
        {subtitle && <p className="-mt-2 mb-4 px-1 text-ink-secondary">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

/** Columna principal (760) + lateral (280) de los formularios. */
export function Layout({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-6">
      <div className="min-w-0 space-y-4">{children}</div>
      {aside && <div className="space-y-4">{aside}</div>}
    </div>
  );
}
