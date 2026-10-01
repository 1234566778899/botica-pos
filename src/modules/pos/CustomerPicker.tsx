import { Pencil, Search, UserPlus, UserRound, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/components/ui";
import type { Customer } from "@/lib/types";
import { docLabel, emptyCustomer, searchCustomers, toInput, useCustomers, type CustomerInput } from "@/modules/customers/api";
import { CustomerModal } from "@/modules/customers/CustomerForm";

const MAX = 6;

/** Datos para registrar a alguien a partir de lo que se escribió: DNI, RUC o nombre. */
function draftFrom(query: string): CustomerInput {
  const q = query.trim();
  if (/^\d{8}$/.test(q)) return emptyCustomer({ doc_number: q });
  if (/^\d{11}$/.test(q)) return emptyCustomer({ doc_type: "RUC", doc_number: q });
  if (/^\d+$/.test(q)) return emptyCustomer({ doc_number: q.slice(0, 11), doc_type: q.length > 8 ? "RUC" : "DNI" });
  return emptyCustomer({ name: q.toUpperCase() });
}

/**
 * Cliente de la venta: se elige entre los registrados (por DNI/RUC o nombre). Si no está,
 * "Registrar cliente nuevo" abre la ficha con el documento escrito y el nombre se completa solo.
 */
export function CustomerPicker({ customer, onChange, onClose }: { customer: Customer | null; onChange: (c: Customer | null) => void; onClose: () => void }) {
  const { data = [], refetch } = useCustomers();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [editing, setEditing] = useState<CustomerInput | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const q = query.trim();
  const results = useMemo(() => (q ? searchCustomers(data, q, MAX) : []), [data, q]);
  const fullDoc = /^(\d{8}|\d{11})$/.test(q);
  const exact = fullDoc ? results.find((c) => c.doc_number === q) : undefined;
  const options = q ? [...results.map((c) => ({ kind: "customer" as const, c })), ...(exact ? [] : [{ kind: "new" as const }])] : [];

  // Un DNI completo que no está en memoria pudo registrarse en otra caja o en el teléfono: se recarga una vez.
  const checked = useRef("");
  useEffect(() => {
    if (fullDoc && !exact && checked.current !== q) { checked.current = q; refetch(); }
  }, [fullDoc, exact, q, refetch]);

  const pick = (c: Customer) => { onChange(c); setQuery(""); setActive(0); };
  const choose = (i: number) => {
    const o = options[i];
    if (!o) return;
    if (o.kind === "customer") pick(o.c);
    else setEditing(draftFrom(q));
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, options.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); choose(exact ? results.indexOf(exact) : active); }
    else if (e.key === "Escape") { e.stopPropagation(); if (q) setQuery(""); else onClose(); }
  };

  const modal = editing && (
    <CustomerModal initial={editing} onClose={() => { setEditing(null); inputRef.current?.focus(); }}
      onSaved={(c) => { setEditing(null); pick(c); }} />
  );

  if (customer) {
    return (
      <div className="flex items-center gap-2.5 rounded-[12px] bg-brand-soft/60 px-3 py-2">
        <UserRound className="size-5 shrink-0 text-brand" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-[650]">{customer.name}</p>
          <p className="truncate text-[12px] text-ink-secondary">{[docLabel(customer), customer.phone].filter(Boolean).join(" · ")}</p>
        </div>
        <button type="button" onClick={() => setEditing(toInput(customer))} aria-label="Editar cliente" className="grid size-8 place-items-center rounded-[8px] text-ink-secondary hover:bg-white"><Pencil className="size-4" /></button>
        <button type="button" onClick={() => onChange(null)} aria-label="Quitar cliente" className="grid size-8 place-items-center rounded-[8px] text-ink-secondary hover:bg-white"><X className="size-4" /></button>
        {modal}
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-secondary" />
          <input ref={inputRef} autoFocus value={query} onChange={(e) => { setQuery(e.target.value); setActive(0); }} onKeyDown={onKey}
            placeholder="Cliente: DNI, RUC o nombre" aria-label="Buscar cliente por DNI, RUC o nombre" role="combobox" aria-expanded={options.length > 0}
            className="h-9 w-full rounded-[10px] pr-3 pl-9 text-[13px] shadow-field outline-none focus:shadow-[0_0_0_2px_var(--color-brand)]" />
        </div>
        <button type="button" onClick={onClose} aria-label="Cerrar" className="grid size-9 place-items-center rounded-[10px] hover:bg-surface-hover"><X className="size-4" /></button>
      </div>
      {options.length > 0 && (
        <ul role="listbox" className="absolute right-0 bottom-full left-0 z-30 mb-1 max-h-[320px] overflow-y-auto rounded-[12px] bg-white p-1.5 shadow-popover">
          {options.map((o, i) => (
            <li key={o.kind === "customer" ? o.c.id : "new"} role="option" aria-selected={i === active}>
              <button type="button" onMouseEnter={() => setActive(i)} onClick={() => choose(i)}
                className={cn("flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left", i === active && "bg-surface-hover")}>
                {o.kind === "customer" ? (
                  <>
                    <UserRound className="size-4 shrink-0 text-ink-secondary" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-[550]">{o.c.name}</span>
                      <span className="block truncate text-[12px] text-ink-secondary">{[docLabel(o.c), o.c.phone, o.c.sales_count ? `${o.c.sales_count} compras` : null].filter(Boolean).join(" · ")}</span>
                    </span>
                  </>
                ) : (
                  <>
                    <UserPlus className="size-4 shrink-0 text-brand" />
                    <span className="text-[13px] font-[550] text-brand">
                      Registrar cliente nuevo{/^\d+$/.test(q) ? ` con ${q.length === 11 ? "RUC" : "DNI"} ${q}` : ""}
                    </span>
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {modal}
    </div>
  );
}
