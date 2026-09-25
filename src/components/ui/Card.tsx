import { cn } from "./cn";

/** Tarjeta: radio 20, sombra en capas (medida del admin de referencia). */
export function Card({ children, className, padded = true }: { children: React.ReactNode; className?: string; padded?: boolean }) {
  return <section className={cn("rounded-[20px] bg-surface shadow-card", padded && "p-4", className)}>{children}</section>;
}

export function CardHeader({ title, actions, description }: { title: React.ReactNode; actions?: React.ReactNode; description?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div>
        <h2 className="text-[13px] font-[650] text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-ink-secondary">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  );
}

/** Franja inferior gris dentro de una tarjeta (p. ej. "SKU · Código de barras"). */
export function CardFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("-mx-4 -mb-4 mt-4 rounded-b-[20px] border-t border-border bg-surface-muted px-4 py-3", className)}>{children}</div>;
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cn("my-4 border-border", className)} />;
}

/** Título de sección fuera de tarjeta ("Precio", "Variantes"). */
export function SectionTitle({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mt-6 mb-2 flex items-center justify-between px-1">
      <h2 className="text-[14px] font-[650] text-ink">{children}</h2>
      {actions}
    </div>
  );
}
