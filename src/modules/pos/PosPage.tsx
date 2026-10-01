import { AlertTriangle, Minus, Plus, Printer, Receipt, ScanBarcode, Search, ShoppingCart, Smartphone, Trash2, UserRound, Wallet, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useBusiness } from "@/components/layout/AppFrame";
import { Badge, Spinner, cn, useToast } from "@/components/ui";
import { daysUntil, expiryLabel, formatExpiry, formatMoney, formatUnits, extraConcentration } from "@/lib/format";
import type { PaymentMethod, ProductStock, SaleDetail, SaleUnit } from "@/lib/types";
import { useStaff } from "@/modules/auth/AuthProvider";
import { lookupCustomer, useCashCurrent, useCategories, useCreateSale, useOpenCash, usePosProducts } from "./api";
import { defaultUnit, unitPrice, unitsPer, useCart } from "./cart";
import { PaymentModal } from "./PaymentModal";
import { type PhoneScanResult, usePhoneScanner } from "./phoneScanner";
import { equivalents, exactCodeMatch, searchProducts } from "./search";
import { printTicket, Ticket, ticketNumber } from "./Ticket";

const MAX_RESULTS = 60;

function OpenCash() {
  const open = useOpenCash();
  const toast = useToast();
  const [amount, setAmount] = useState("");
  return (
    <div className="grid h-full place-items-center bg-surface-muted p-4">
      <form
        onSubmit={(e) => { e.preventDefault(); open.mutate(Number(amount || 0), { onError: (err) => toast(err.message, { error: true }) }); }}
        className="w-full max-w-[380px] rounded-[20px] bg-white p-6 text-center shadow-card"
      >
        <Wallet className="mx-auto size-10 text-brand" strokeWidth={1.5} />
        <h1 className="mt-3 text-[20px] font-[650]">Abre la caja para vender</h1>
        <p className="mt-1 text-ink-secondary">Cuenta el dinero con el que empiezas el turno (sencillo para dar vuelto).</p>
        <div className="relative mt-5">
          <span className="absolute top-1/2 left-4 -translate-y-1/2 text-[18px] text-ink-secondary">S/</span>
          <input autoFocus inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
            aria-label="Fondo inicial" className="h-12 w-full rounded-[12px] pr-4 pl-11 text-[20px] font-[650] shadow-field outline-none focus:shadow-[0_0_0_2px_var(--color-brand)]" />
        </div>
        <button disabled={open.isPending} className="mt-4 h-12 w-full rounded-[12px] bg-brand text-[15px] font-[650] text-white hover:bg-brand-dark disabled:opacity-60">
          {open.isPending ? "Abriendo…" : "Abrir caja"}
        </button>
      </form>
    </div>
  );
}

function ProductRow({ p, available, active, onAdd, onHover, onShowEquivalents, equivalentsCount }: {
  p: ProductStock; available: number; active: boolean; equivalentsCount: number;
  onAdd: (unit: SaleUnit) => void; onHover: () => void; onShowEquivalents: () => void;
}) {
  const days = daysUntil(p.next_expiry);
  const soon = days !== null && days <= 90;
  const outOfStock = available <= 0;
  const canUnit = p.sell_by_unit || p.units_per_pack === 1;
  const hasPack = p.units_per_pack > 1;

  return (
    <li
      data-active={active || undefined}
      onMouseEnter={onHover}
      className={cn("group flex items-center gap-3 rounded-[12px] px-3 py-2.5 transition-colors", active ? "bg-brand-soft shadow-[inset_0_0_0_1.5px_var(--color-brand)]" : "hover:bg-surface-muted", outOfStock && "opacity-75")}
    >
      <span className="h-10 w-1 shrink-0 rounded-full" style={{ background: p.category_color ?? "#cccccc" }} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[15px] font-[650]">{p.name}</span>
          {extraConcentration(p.name, p.concentration) && <span className="text-[13px] font-[550] text-ink-secondary">{extraConcentration(p.name, p.concentration)}</span>}
          {p.requires_prescription && <Badge tone="warning">Receta</Badge>}
          {p.is_controlled && <Badge tone="critical">Controlado</Badge>}
        </p>
        <p className="truncate text-[12px] text-ink-secondary">
          {[p.generic_name, p.presentation, p.laboratory].filter(Boolean).join(" · ")}
          {p.location && <span className="ml-1 text-ink-tertiary">· Estante {p.location}</span>}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[12px]">
          <span className={cn("font-[550]", outOfStock ? "text-critical-strong" : available <= p.min_stock ? "text-warning" : "text-success")}>
            {outOfStock ? "Agotado" : `Stock: ${formatUnits(available, p.units_per_pack)}`}
          </span>
          {p.next_expiry && <span className={soon ? "font-[550] text-critical" : "text-ink-tertiary"}>{soon ? expiryLabel(days) : `Vence ${formatExpiry(p.next_expiry)}`}</span>}
          {equivalentsCount > 0 && (
            <button type="button" onClick={onShowEquivalents} className="text-brand hover:underline">
              {equivalentsCount} {equivalentsCount === 1 ? "equivalente" : "equivalentes"}
            </button>
          )}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {canUnit && (
          <button type="button" disabled={outOfStock} onClick={() => onAdd("unidad")}
            className="flex h-12 min-w-[92px] flex-col items-center justify-center rounded-[10px] bg-white px-2 shadow-button hover:bg-surface-hover disabled:opacity-40">
            <span className="text-[15px] font-[700] tabular-nums">{formatMoney(p.price_unit)}</span>
            <span className="text-[11px] text-ink-secondary">{hasPack ? "unidad" : "agregar"}</span>
          </button>
        )}
        {hasPack && (
          <button type="button" disabled={available < p.units_per_pack} onClick={() => onAdd("caja")}
            className="flex h-12 min-w-[92px] flex-col items-center justify-center rounded-[10px] bg-white px-2 shadow-button hover:bg-surface-hover disabled:opacity-40">
            <span className="text-[15px] font-[700] tabular-nums">{formatMoney(unitPrice(p, "caja"))}</span>
            <span className="text-[11px] text-ink-secondary">caja x{p.units_per_pack}</span>
          </button>
        )}
      </div>
    </li>
  );
}

function SuccessModal({ sale, onNew }: { sale: SaleDetail; onNew: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); onNew(); }
      if (e.key.toLowerCase() === "p") printTicket();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onNew]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 p-4 pt-[12vh]">
      <div role="dialog" aria-label="Venta registrada" className="w-full max-w-[420px] rounded-[20px] bg-white p-6 text-center shadow-popover">
        <div className="mx-auto grid size-14 place-items-center rounded-full bg-success-soft text-success"><Receipt className="size-7" strokeWidth={1.6} /></div>
        <h2 className="mt-3 text-[20px] font-[650]">Venta registrada</h2>
        <p className="text-ink-secondary">{ticketNumber(sale.number)} · {formatMoney(sale.total)}</p>
        {sale.change_given != null && (
          <div className="mt-4 rounded-[14px] bg-success-soft px-4 py-3 text-success">
            <p className="text-[13px] font-[550]">Vuelto</p>
            <p className="text-[36px] leading-tight font-[700] tabular-nums">{formatMoney(sale.change_given)}</p>
          </div>
        )}
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={printTicket} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-[12px] font-[550] shadow-button hover:bg-surface-muted">
            <Printer className="size-4" /> Imprimir (P)
          </button>
          <button type="button" autoFocus onClick={onNew} className="h-12 flex-1 rounded-[12px] bg-brand font-[650] text-white hover:bg-brand-dark">Nueva venta (Enter)</button>
        </div>
      </div>
      <Ticket sale={sale} />
    </div>
  );
}

export function PosPage() {
  const cash = useCashCurrent();
  const products = usePosProducts();
  const categories = useCategories();
  const { data: business } = useBusiness();
  const createSale = useCreateSale();
  const toast = useToast();
  const { lines, dispatch, totals, unitsInCart } = useCart(Number(business?.igv_rate ?? 18));

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [done, setDone] = useState<SaleDetail | null>(null);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customer, setCustomer] = useState({ doc: "", name: "" });
  const [lookup, setLookup] = useState<{ doc: string; state: "loading" | "found" | "missing" | "error"; message?: string } | null>(null);
  const autoName = useRef("");

  // DNI (8) o RUC (11) completo: busca el nombre. Solo reemplaza un nombre vacío o puesto por la búsqueda anterior.
  useEffect(() => {
    const doc = customer.doc;
    if (doc.length !== 8 && doc.length !== 11) return; // el aviso solo se muestra si lookup.doc es el DNI actual
    let alive = true;
    const t = setTimeout(() => {
      setLookup({ doc, state: "loading" });
      lookupCustomer(doc).then(
        (name) => {
          if (!alive) return;
          if (!name) { setLookup({ doc, state: "missing" }); return; }
          setLookup({ doc, state: "found" });
          // El updater corre después: compara con el nombre automático anterior, no con el nuevo.
          const previous = autoName.current;
          autoName.current = name;
          setCustomer((c) => (c.doc === doc && (!c.name.trim() || c.name === previous) ? { ...c, name } : c));
        },
        (e: Error) => alive && setLookup({ doc, state: "error", message: e.message }),
      );
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [customer.doc]);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const all = useMemo(() => products.data ?? [], [products.data]);
  const results = useMemo(() => searchProducts(all, query, category).slice(0, MAX_RESULTS), [all, query, category]);
  const available = (p: ProductStock) => p.stock - unitsInCart(p.id);

  // El catálogo está en memoria: si el código no aparece puede ser que se registró después
  // (p. ej. desde la app Android), así que se recarga una vez antes de darlo por desconocido.
  const { refetch: refetchProducts } = products;
  const findByCode = useCallback(
    async (code: string) => exactCodeMatch(all, code) ?? exactCodeMatch((await refetchProducts()).data ?? [], code),
    [all, refetchProducts],
  );

  const focusSearch = () => searchRef.current?.focus();

  const add = useCallback((p: ProductStock, unit: SaleUnit = defaultUnit(p)) => {
    const need = unit === "caja" ? p.units_per_pack : 1;
    const left = p.stock - unitsInCart(p.id);
    if (left < need) return toast(left <= 0 ? `${p.name}: sin stock disponible` : `${p.name}: solo quedan ${formatUnits(left, p.units_per_pack)}`, { error: true });
    dispatch({ type: "add", product: p, unit });
    if (p.requires_prescription) toast(`${p.name} requiere receta médica`);
    setQuery("");
    setActive(0);
    focusSearch();
  }, [dispatch, toast, unitsInCart]);

  const openPayment = useCallback(() => {
    if (lines.length === 0) return;
    setPayError(null);
    setPaying(true);
  }, [lines.length]);

  // Atajos: F2 buscar, F9 cobrar, Esc limpiar búsqueda.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (paying || done) return;
      if (e.key === "F2") { e.preventDefault(); focusSearch(); }
      if (e.key === "F9") { e.preventDefault(); openPayment(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [paying, done, openPayment]);

  useEffect(() => {
    listRef.current?.querySelector("[data-active]")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Escape") { setQuery(""); setActive(0); }
    else if (e.key === "Enter") {
      e.preventDefault();
      // Lector de código de barras: escribe el código y Enter.
      const exact = exactCodeMatch(all, query);
      const target = exact ?? results[active];
      const box = e.shiftKey;
      if (target) add(target, box && target.units_per_pack > 1 ? "caja" : defaultUnit(target));
      else if (query.trim()) findByCode(query).then((p) => p && add(p, box && p.units_per_pack > 1 ? "caja" : defaultUnit(p)));
    }
  };

  const confirmSale = (method: PaymentMethod, received?: number) => {
    setPayError(null);
    createSale.mutate(
      {
        items: lines.map((l) => ({ product_id: l.product.id, unit: l.unit, quantity: l.quantity })),
        payment: { method, received },
        customer: customer.doc.trim() ? { doc_number: customer.doc.trim(), name: customer.name.trim() } : undefined,
      },
      {
        onSuccess: (sale) => { setPaying(false); setDone(sale); },
        onError: (err) => setPayError(err.message),
      },
    );
  };

  // Celular como escáner inalámbrico (app Android con la misma cuenta).
  const staff = useStaff();
  const onPhoneScan = useCallback(async (code: string): Promise<PhoneScanResult> => {
    if (paying || done) return { ok: false, text: "La web está cobrando: termina la venta primero" };
    const p = await findByCode(code);
    if (!p) {
      toast(`📱 Código ${code} no registrado`, { error: true });
      return { ok: false, text: `Código ${code} no registrado en la web` };
    }
    const unit = defaultUnit(p);
    const left = p.stock - unitsInCart(p.id);
    if (left < (unit === "caja" ? p.units_per_pack : 1)) {
      toast(`📱 ${p.name}: sin stock disponible`, { error: true });
      return { ok: false, text: `${p.name}: sin stock` };
    }
    dispatch({ type: "add", product: p, unit });
    toast(`📱 ${p.name}${p.requires_prescription ? " · requiere receta" : ""}`);
    return { ok: true, text: p.name };
  }, [dispatch, done, findByCode, paying, toast, unitsInCart]);
  const phoneConnected = usePhoneScanner(cash.data ? staff.user_id : undefined, onPhoneScan);

  const newSale = useCallback(() => {
    dispatch({ type: "clear" });
    setDone(null);
    setCustomer({ doc: "", name: "" });
    setCustomerOpen(false);
    setTimeout(focusSearch, 0);
  }, [dispatch]);

  if (cash.isLoading) return <div className="grid h-full place-items-center"><Spinner /></div>;
  if (!cash.data) return <OpenCash />;

  return (
    <div className="flex h-full min-h-0">
      {/* Catálogo */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="shrink-0 space-y-2.5 border-b border-border px-4 pt-4 pb-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-ink-secondary" />
              <input
                ref={searchRef}
                autoFocus
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                onKeyDown={onSearchKey}
                placeholder="Buscar por nombre, principio activo, laboratorio o código de barras…"
                aria-label="Buscar producto"
                className="h-12 w-full rounded-[14px] bg-white pr-24 pl-12 text-[16px] shadow-field outline-none placeholder:text-ink-tertiary focus:shadow-[0_0_0_2px_var(--color-brand)]"
              />
              {query ? (
                <button type="button" onClick={() => { setQuery(""); focusSearch(); }} aria-label="Limpiar búsqueda" className="absolute top-1/2 right-3 grid size-7 -translate-y-1/2 place-items-center rounded-full hover:bg-surface-hover">
                  <X className="size-4" />
                </button>
              ) : (
                <span className="pointer-events-none absolute top-1/2 right-3 flex -translate-y-1/2 items-center gap-1 text-[11px] text-ink-tertiary">
                  <ScanBarcode className="size-4" /> F2
                </span>
              )}
            </div>
            {phoneConnected && (
              <span className="flex shrink-0 items-center gap-2 rounded-[12px] bg-brand-soft px-3 py-2 text-[12px] font-[550] text-brand-dark" title="Escanea con la app del celular: los productos aparecen aquí">
                <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60" /><span className="relative inline-flex size-2 rounded-full bg-brand" /></span>
                <Smartphone className="size-4" /> Celular conectado
              </span>
            )}
            <Link to="/caja" className="hidden shrink-0 items-center gap-2 rounded-[12px] bg-success-soft px-3 py-2 text-[12px] text-success md:flex" title="Ver caja">
              <Wallet className="size-4" />
              <span><span className="block font-[650]">Caja abierta</span>{cash.data.sales_count} ventas · {formatMoney(cash.data.sales_total)}</span>
            </Link>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
            <button type="button" onClick={() => setCategory(null)} className={cn("h-8 shrink-0 rounded-full px-3.5 text-[13px] font-[550]", !category ? "bg-button text-white" : "bg-surface-muted hover:bg-surface-pressed")}>Todos</button>
            {categories.data?.map((c) => (
              <button key={c.id} type="button" onClick={() => { setCategory(category === c.id ? null : c.id); setActive(0); focusSearch(); }}
                className={cn("flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-[550]", category === c.id ? "bg-button text-white" : "bg-surface-muted hover:bg-surface-pressed")}>
                <span className="size-2 rounded-full" style={{ background: c.color }} /> {c.name}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {products.isLoading ? (
            <div className="grid h-40 place-items-center"><Spinner /></div>
          ) : results.length === 0 ? (
            <div className="py-16 text-center text-ink-secondary">
              <p className="text-[15px] font-[550] text-ink">No encontramos “{query}”</p>
              <p className="mt-1">Prueba con el principio activo (ej. “paracetamol”) o revisa la ortografía.</p>
            </div>
          ) : (
            <ul ref={listRef} className="space-y-0.5">
              {results.map((p, i) => (
                <ProductRow key={p.id} p={p} available={available(p)} active={i === active}
                  equivalentsCount={equivalents(all, p).length}
                  onHover={() => setActive(i)}
                  onAdd={(unit) => add(p, unit)}
                  onShowEquivalents={() => { setQuery(p.generic_name ?? ""); setCategory(null); setActive(0); focusSearch(); }} />
              ))}
            </ul>
          )}
        </div>
        <p className="hidden shrink-0 gap-4 border-t border-border px-4 py-2 text-[11px] text-ink-tertiary lg:flex">
          <span><kbd className="font-sans font-[650]">↑ ↓</kbd> elegir</span>
          <span><kbd className="font-sans font-[650]">Enter</kbd> agregar</span>
          <span><kbd className="font-sans font-[650]">Shift + Enter</kbd> agregar caja</span>
          <span><kbd className="font-sans font-[650]">F9</kbd> cobrar</span>
          <span><kbd className="font-sans font-[650]">Esc</kbd> limpiar</span>
        </p>
      </section>

      {/* Venta actual */}
      <aside className="flex w-[380px] shrink-0 flex-col border-l border-border bg-surface-muted xl:w-[420px]">
        <header className="flex h-12 shrink-0 items-center justify-between px-4">
          <h2 className="flex items-center gap-2 text-[15px] font-[650]"><ShoppingCart className="size-4" /> Venta actual</h2>
          {lines.length > 0 && (
            <button type="button" onClick={() => dispatch({ type: "clear" })} className="text-[12px] text-ink-secondary hover:text-critical-strong">Vaciar</button>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-3">
          {lines.length === 0 ? (
            <div className="grid h-full place-items-center px-6 text-center text-ink-secondary">
              <div>
                <ScanBarcode className="mx-auto size-10 text-ink-tertiary" strokeWidth={1.3} />
                <p className="mt-2">Busca o escanea un producto para empezar.</p>
              </div>
            </div>
          ) : (
            <ul className="space-y-2 pb-2">
              {lines.map((l, i) => {
                const p = l.product;
                const price = unitPrice(p, l.unit);
                const inCart = unitsInCart(p.id);
                const over = inCart > p.stock;
                const canAddMore = inCart + unitsPer(l) <= p.stock;
                return (
                  <li key={`${p.id}-${l.unit}`} className="rounded-[14px] bg-white p-3 shadow-card">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] leading-tight font-[650]">{p.name} {extraConcentration(p.name, p.concentration) && <span className="font-[450] text-ink-secondary">{extraConcentration(p.name, p.concentration)}</span>}</p>
                        <p className="text-[12px] text-ink-secondary">{formatMoney(price)} {l.unit === "caja" ? `por caja x${p.units_per_pack}` : "c/u"}</p>
                      </div>
                      <button type="button" onClick={() => dispatch({ type: "remove", index: i })} aria-label={`Quitar ${p.name}`} className="grid size-7 place-items-center rounded-[8px] text-ink-tertiary hover:bg-critical-soft hover:text-critical-strong">
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex items-center rounded-[10px] bg-surface-muted">
                        <button type="button" onClick={() => dispatch({ type: "set-qty", index: i, quantity: l.quantity - 1 })} aria-label="Menos" className="grid size-9 place-items-center rounded-[10px] hover:bg-surface-pressed"><Minus className="size-4" /></button>
                        <input
                          value={l.quantity}
                          inputMode="numeric"
                          aria-label="Cantidad"
                          onChange={(e) => dispatch({ type: "set-qty", index: i, quantity: Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1) })}
                          className="w-10 bg-transparent text-center text-[15px] font-[650] tabular-nums outline-none"
                        />
                        <button type="button" onClick={() => (!canAddMore ? toast("No hay más stock de este producto", { error: true }) : dispatch({ type: "set-qty", index: i, quantity: l.quantity + 1 }))} aria-label="Más" className="grid size-9 place-items-center rounded-[10px] hover:bg-surface-pressed"><Plus className="size-4" /></button>
                      </div>
                      {p.units_per_pack > 1 && p.sell_by_unit && (
                        <div className="flex rounded-[10px] bg-surface-muted p-0.5 text-[12px] font-[550]">
                          {(["unidad", "caja"] as const).map((u) => (
                            <button key={u} type="button" onClick={() => dispatch({ type: "set-unit", index: i, unit: u })}
                              className={cn("h-8 rounded-[8px] px-2.5 capitalize", l.unit === u ? "bg-white shadow-button" : "text-ink-secondary")}>{u}</button>
                          ))}
                        </div>
                      )}
                      <span className="ml-auto text-[15px] font-[700] tabular-nums">{formatMoney(price * l.quantity)}</span>
                    </div>
                    {over && <p className="mt-1.5 flex items-center gap-1 text-[12px] text-critical-strong"><AlertTriangle className="size-3.5" /> Supera el stock ({formatUnits(p.stock, p.units_per_pack)})</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="shrink-0 space-y-3 border-t border-border bg-white p-4">
          {customerOpen ? (
            <div className="grid grid-cols-[120px_1fr_auto] gap-2">
              <input placeholder="DNI / RUC" inputMode="numeric" value={customer.doc} onChange={(e) => {
                const doc = e.target.value.replace(/\D/g, "").slice(0, 11);
                // Otro documento: el nombre que puso la búsqueda ya no corresponde (uno escrito a mano se respeta).
                setCustomer({ doc, name: doc !== customer.doc && customer.name === autoName.current ? "" : customer.name });
              }}
                aria-label="DNI o RUC del cliente" className="h-9 rounded-[10px] px-3 text-[13px] shadow-field outline-none focus:shadow-[0_0_0_2px_var(--color-brand)]" />
              <input placeholder="Nombre del cliente" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
                aria-label="Nombre del cliente" className="h-9 min-w-0 rounded-[10px] px-3 text-[13px] shadow-field outline-none focus:shadow-[0_0_0_2px_var(--color-brand)]" />
              <button type="button" onClick={() => { setCustomerOpen(false); setCustomer({ doc: "", name: "" }); }} aria-label="Quitar cliente" className="grid size-9 place-items-center rounded-[10px] hover:bg-surface-hover"><X className="size-4" /></button>
              {lookup && lookup.doc === customer.doc && lookup.state !== "found" && (
                <p className={cn("col-span-3 flex items-center gap-1.5 text-[12px]", lookup.state === "loading" ? "text-ink-secondary" : "text-warning")}>
                  {lookup.state === "loading" && <><Spinner className="size-3.5" /> Buscando el nombre…</>}
                  {lookup.state === "missing" && `No se encontró ese ${customer.doc.length === 8 ? "DNI" : "RUC"}: escribe el nombre.`}
                  {lookup.state === "error" && `No se pudo buscar el nombre (${lookup.message}). Escríbelo.`}
                </p>
              )}
            </div>
          ) : (
            <button type="button" onClick={() => setCustomerOpen(true)} className="flex items-center gap-1.5 text-[13px] text-brand hover:underline">
              <UserRound className="size-4" /> Agregar cliente (DNI / RUC)
            </button>
          )}

          <dl className="space-y-1 text-[13px]">
            <div className="flex justify-between text-ink-secondary"><dt>Artículos</dt><dd className="tabular-nums">{totals.count}</dd></div>
            <div className="flex justify-between text-ink-secondary"><dt>Op. gravada</dt><dd className="tabular-nums">{formatMoney(totals.total - totals.igv)}</dd></div>
            <div className="flex justify-between text-ink-secondary"><dt>IGV ({Number(business?.igv_rate ?? 18)}%)</dt><dd className="tabular-nums">{formatMoney(totals.igv)}</dd></div>
            <div className="flex items-baseline justify-between pt-1"><dt className="text-[15px] font-[650]">Total</dt><dd className="text-[28px] font-[700] tabular-nums">{formatMoney(totals.total)}</dd></div>
          </dl>
          <button type="button" onClick={openPayment} disabled={lines.length === 0}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-[14px] bg-brand text-[17px] font-[700] text-white shadow-[inset_0_1px_0_rgba(255,255,255,.2)] hover:bg-brand-dark disabled:opacity-40">
            Cobrar {lines.length > 0 && formatMoney(totals.total)} <span className="text-[12px] font-[550] text-white/70">F9</span>
          </button>
        </div>
      </aside>

      {paying && <PaymentModal total={totals.total} loading={createSale.isPending} error={payError} onClose={() => setPaying(false)} onConfirm={confirmSale} />}
      {done && <SuccessModal sale={done} onNew={newSale} />}
    </div>
  );
}
