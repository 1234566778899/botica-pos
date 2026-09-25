import { Banknote, CreditCard, Landmark, Smartphone } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import type { PaymentMethod } from "@/lib/types";

const methods: { value: PaymentMethod; label: string; icon: typeof Banknote }[] = [
  { value: "efectivo", label: "Efectivo", icon: Banknote },
  { value: "yape", label: "Yape", icon: Smartphone },
  { value: "plin", label: "Plin", icon: Smartphone },
  { value: "tarjeta", label: "Tarjeta", icon: CreditCard },
  { value: "transferencia", label: "Transferencia", icon: Landmark },
];

/** Billetes típicos para cobrar con un clic (solo los que alcanzan el total). */
const quickAmounts = (total: number) => {
  const out: { label: string; value: number }[] = [{ label: "Exacto", value: total }];
  const rounded = Math.ceil(total);
  if (rounded !== total) out.push({ label: `S/ ${rounded}`, value: rounded });
  for (const b of [10, 20, 50, 100, 200]) if (b > rounded) out.push({ label: `S/ ${b}`, value: b });
  return out.slice(0, 6);
};

export function PaymentModal({ total, loading, error, onClose, onConfirm }: {
  total: number;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (method: PaymentMethod, received?: number) => void;
}) {
  const [method, setMethod] = useState<PaymentMethod>("efectivo");
  const [received, setReceived] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const amount = received === "" ? total : Number(received);
  const change = amount - total;
  const valid = method !== "efectivo" || (Number.isFinite(amount) && amount >= total);

  useEffect(() => { if (method === "efectivo") inputRef.current?.focus(); }, [method]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      // Atajos 1-5 para elegir el método de pago (si no se está escribiendo el monto).
      if (document.activeElement !== inputRef.current && /^[1-5]$/.test(e.key)) setMethod(methods[Number(e.key) - 1].value);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const confirm = () => valid && !loading && onConfirm(method, method === "efectivo" ? amount : undefined);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 p-4 pt-[8vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        role="dialog"
        aria-label="Cobrar"
        onSubmit={(e) => { e.preventDefault(); confirm(); }}
        className="w-full max-w-[520px] rounded-[20px] bg-white p-5 shadow-popover"
      >
        <p className="text-center text-[13px] text-ink-secondary">Total a cobrar</p>
        <p className="text-center text-[40px] leading-tight font-[700] tabular-nums">{formatMoney(total)}</p>

        <div className="mt-4 grid grid-cols-5 gap-2">
          {methods.map((m, i) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setMethod(m.value)}
              aria-pressed={method === m.value}
              className={cn("flex h-[72px] flex-col items-center justify-center gap-1 rounded-[12px] text-[12px] font-[550] transition-colors",
                method === m.value ? "bg-brand text-white shadow-[0_0_0_2px_var(--color-brand)]" : "bg-surface-muted text-ink hover:bg-surface-pressed")}
            >
              <m.icon className="size-5" strokeWidth={1.8} />
              {m.label}
              <span className={cn("text-[10px]", method === m.value ? "text-white/70" : "text-ink-tertiary")}>{i + 1}</span>
            </button>
          ))}
        </div>

        {method === "efectivo" ? (
          <div className="mt-5">
            <label htmlFor="received" className="text-[13px] font-medium">Recibido</label>
            <div className="relative mt-1">
              <span className="absolute top-1/2 left-4 -translate-y-1/2 text-[20px] text-ink-secondary">S/</span>
              <input
                ref={inputRef}
                id="received"
                inputMode="decimal"
                value={received}
                placeholder={total.toFixed(2)}
                onChange={(e) => setReceived(e.target.value.replace(/[^\d.]/g, ""))}
                className="h-14 w-full rounded-[12px] bg-white pr-4 pl-12 text-[24px] font-[650] tabular-nums shadow-field outline-none focus:shadow-[0_0_0_2px_var(--color-brand)]"
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {quickAmounts(total).map((a) => (
                <button key={a.label} type="button" onClick={() => setReceived(a.value.toFixed(2))} className="h-9 rounded-[10px] bg-surface-muted px-3 text-[13px] font-[550] hover:bg-surface-pressed">
                  {a.label}
                </button>
              ))}
            </div>
            <div className={cn("mt-4 flex items-center justify-between rounded-[12px] px-4 py-3", change >= 0 ? "bg-success-soft text-success" : "bg-critical-soft text-critical")}>
              <span className="text-[14px] font-[550]">{change >= 0 ? "Vuelto" : "Falta"}</span>
              <span className="text-[26px] font-[700] tabular-nums">{formatMoney(Math.abs(change))}</span>
            </div>
          </div>
        ) : (
          <p className="mt-5 rounded-[12px] bg-surface-muted px-4 py-3 text-center text-ink-secondary">
            Confirma que recibiste el pago por <strong className="text-ink">{methods.find((m) => m.value === method)?.label}</strong> antes de continuar.
          </p>
        )}

        {error && <p role="alert" className="mt-3 rounded-[10px] bg-critical-soft px-3 py-2 text-critical">{error}</p>}

        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onClose} className="h-12 rounded-[12px] px-5 font-[550] shadow-button hover:bg-surface-muted">Cancelar</button>
          <button type="submit" disabled={!valid || loading} className="h-12 flex-1 rounded-[12px] bg-brand text-[16px] font-[650] text-white hover:bg-brand-dark disabled:opacity-50">
            {loading ? "Registrando…" : "Confirmar venta (Enter)"}
          </button>
        </div>
      </form>
    </div>
  );
}
