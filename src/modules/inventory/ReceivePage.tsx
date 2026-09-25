import { PackagePlus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Button, Card, CardHeader, cn, Layout, Page, Select, TextArea, TextField, useToast } from "@/components/ui";
import { addDays, formatMoney, formatUnits, todayLima, extraConcentration } from "@/lib/format";
import type { ProductStock } from "@/lib/types";
import { usePosProducts } from "@/modules/pos/api";
import { exactCodeMatch, searchProducts } from "@/modules/pos/search";
import { useReceive, useSuppliers } from "./api";

type Row = { key: number; product: ProductStock; lot: string; expiry: string; qty: string; unit: "caja" | "unidad"; cost: string };

const toUnits = (r: Row) => (Number(r.qty) || 0) * (r.unit === "caja" ? r.product.units_per_pack : 1);
/** El costo se ingresa por la unidad elegida (caja o unidad) y se guarda por unidad. */
const costPerUnit = (r: Row) => (Number(r.cost) || 0) / (r.unit === "caja" ? r.product.units_per_pack : 1);

function ProductPicker({ onPick }: { onPick: (p: ProductStock) => void }) {
  const { data = [] } = usePosProducts();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const results = useMemo(() => (q.trim() ? searchProducts(data, q, null).slice(0, 8) : []), [data, q]);
  const pick = (p: ProductStock) => { onPick(p); setQ(""); setActive(0); };
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-secondary" />
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          if (e.key === "Enter") { e.preventDefault(); const p = exactCodeMatch(data, q) ?? results[active]; if (p) pick(p); }
        }}
        placeholder="Agregar producto: nombre, principio activo o código de barras"
        aria-label="Agregar producto"
        className="h-10 w-full rounded-[12px] bg-white pr-3 pl-9 text-[14px] shadow-field outline-none focus:shadow-[0_0_0_2px_var(--color-brand)]"
      />
      {open && results.length > 0 && (
        <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-[12px] bg-white p-1.5 shadow-popover">
          {results.map((p, i) => (
            <li key={p.id}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p)} onMouseEnter={() => setActive(i)}
                className={cn("flex w-full items-center gap-2 rounded-[8px] px-2.5 py-2 text-left", i === active && "bg-surface-hover")}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-[550]">{p.name} {extraConcentration(p.name, p.concentration) && <span className="font-normal text-ink-secondary">{extraConcentration(p.name, p.concentration)}</span>}</span>
                  <span className="block truncate text-[12px] text-ink-secondary">{[p.presentation, p.laboratory].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="text-[12px] text-ink-secondary">Stock {formatUnits(p.stock, p.units_per_pack)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

let nextKey = 1;

export function ReceivePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const { data: products = [] } = usePosProducts();
  const { data: suppliers = [] } = useSuppliers();
  const receive = useReceive();
  const [supplier, setSupplier] = useState("");
  const [invoice, setInvoice] = useState("");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const preloaded = useRef(false);

  const addProduct = (p: ProductStock) =>
    setRows((r) => [...r, { key: nextKey++, product: p, lot: "", expiry: addDays(todayLima(), 365), qty: "1", unit: p.units_per_pack > 1 ? "caja" : "unidad", cost: (Number(p.cost_unit) * (p.units_per_pack > 1 ? p.units_per_pack : 1)).toFixed(2) }]);

  // /ingresos/nuevo?producto=<id> precarga ese producto.
  useEffect(() => {
    const id = params.get("producto");
    const p = id && products.find((x) => x.id === id);
    if (p && !preloaded.current) { preloaded.current = true; addProduct(p); }
  }, [params, products]);

  const update = (key: number, patch: Partial<Row>) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const total = rows.reduce((n, r) => n + toUnits(r) * costPerUnit(r), 0);
  const today = todayLima();

  const submit = () => {
    const bad = rows.find((r) => !r.lot.trim() || toUnits(r) <= 0);
    if (rows.length === 0) return toast("Agrega al menos un producto", { error: true });
    if (bad) return toast(`Completa el lote y la cantidad de ${bad.product.name}`, { error: true });
    receive.mutate(
      { supplier_id: supplier || null, invoice_number: invoice, note, items: rows.map((r) => ({ product_id: r.product.id, lot_number: r.lot, expiry_date: r.expiry, units: toUnits(r), cost_unit: Math.round(costPerUnit(r) * 10000) / 10000 })) },
      { onSuccess: (p) => { toast(`Ingreso #${p.number} registrado`); navigate("/ingresos"); }, onError: (e) => toast(e.message, { error: true }) },
    );
  };

  return (
    <Page title="Nuevo ingreso" breadcrumbs={[{ label: "Ingresos", to: "/ingresos" }]} largeTitle width="full"
      actions={<Button variant="primary" icon={PackagePlus} onClick={submit} loading={receive.isPending}>Registrar ingreso</Button>}>
      <Layout
        aside={
          <>
            <Card>
              <CardHeader title="Documento" />
              <div className="space-y-3">
                <Select label="Proveedor" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Sin proveedor" options={suppliers.map((s) => ({ value: s.id, label: s.name }))} />
                <TextField label="N.° de factura o guía" value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder="F001-000123" />
                <TextArea label="Nota" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </Card>
            <Card>
              <CardHeader title="Resumen" />
              <p className="text-ink-secondary">{rows.length} productos · {rows.reduce((n, r) => n + toUnits(r), 0)} unidades</p>
              <p className="mt-1 text-[22px] font-[650] tabular-nums">{formatMoney(total)}</p>
              <p className="text-[12px] text-ink-tertiary">Costo total del ingreso</p>
            </Card>
          </>
        }
      >
        <Card>
          <ProductPicker onPick={addProduct} />
          {rows.length === 0 ? (
            <p className="py-10 text-center text-ink-secondary">Busca o escanea los productos que llegaron.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {rows.map((r) => {
                const days = r.expiry ? Math.round((new Date(`${r.expiry}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86400000) : null;
                return (
                  <li key={r.key} className="py-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-[550]">{r.product.name} {extraConcentration(r.product.name, r.product.concentration) && <span className="font-normal text-ink-secondary">{extraConcentration(r.product.name, r.product.concentration)}</span>}</p>
                        <p className="text-[12px] text-ink-secondary">{r.product.presentation} · stock actual {formatUnits(r.product.stock, r.product.units_per_pack)}</p>
                      </div>
                      <Button variant="plain" size="icon" icon={Trash2} onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>Quitar</Button>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-[1fr_150px_110px_120px_130px]">
                      <TextField label="Lote" value={r.lot} onChange={(e) => update(r.key, { lot: e.target.value.toUpperCase() })} placeholder="L2409" />
                      <TextField label="Vencimiento" type="date" value={r.expiry} min={today} onChange={(e) => update(r.key, { expiry: e.target.value })}
                        error={days !== null && days < 90 ? `Vence en ${days} días` : undefined} />
                      <TextField label="Cantidad" type="number" min="1" value={r.qty} onChange={(e) => update(r.key, { qty: e.target.value })} />
                      {r.product.units_per_pack > 1 ? (
                        <Select label="Unidad" value={r.unit} onChange={(e) => {
                          const unit = e.target.value as Row["unit"];
                          const factor = unit === "caja" ? r.product.units_per_pack : 1 / r.product.units_per_pack;
                          update(r.key, { unit, cost: ((Number(r.cost) || 0) * factor).toFixed(2) });
                        }} options={[{ value: "caja", label: `Cajas x${r.product.units_per_pack}` }, { value: "unidad", label: "Unidades" }]} />
                      ) : <div className="hidden sm:block" />}
                      <TextField label={`Costo por ${r.unit}`} type="number" min="0" step="0.01" prefix="S/" value={r.cost} onChange={(e) => update(r.key, { cost: e.target.value })} />
                    </div>
                    <p className="mt-1 text-[12px] text-ink-secondary">= {toUnits(r)} unidades · {formatMoney(toUnits(r) * costPerUnit(r))}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </Layout>
    </Page>
  );
}
