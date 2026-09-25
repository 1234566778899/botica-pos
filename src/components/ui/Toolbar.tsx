import { Search, X } from "lucide-react";
import { cn } from "./cn";

/** Pestañas de vistas ("Todos", "Activos"…) + buscador, en la parte superior de la tabla. */
export function IndexToolbar<V extends string>({ views, view, onViewChange, search, onSearchChange, placeholder = "Buscar", filters }: {
  views: { value: V; label: string }[];
  view: V;
  onViewChange: (v: V) => void;
  search: string;
  onSearchChange: (s: string) => void;
  placeholder?: string;
  filters?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-2 py-1.5">
      <div className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto">
        {views.map((v) => (
          <button
            key={v.value}
            type="button"
            onClick={() => onViewChange(v.value)}
            className={cn("h-7 shrink-0 rounded-[8px] px-2.5 text-[12px] font-[550]", view === v.value ? "bg-surface-pressed text-ink" : "text-ink-secondary hover:bg-surface-hover")}
          >
            {v.label}
          </button>
        ))}
      </div>
      {filters}
      <div className="relative w-full sm:w-[240px]">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-secondary" />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-7 w-full rounded-[8px] bg-white pr-7 pl-8 text-[12px] shadow-field outline-none placeholder:text-ink-tertiary focus:shadow-[0_0_0_2px_var(--color-brand)] [&::-webkit-search-cancel-button]:hidden"
        />
        {search && (
          <button type="button" onClick={() => onSearchChange("")} aria-label="Limpiar búsqueda" className="absolute top-1/2 right-2 -translate-y-1/2 text-ink-secondary">
            <X className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
