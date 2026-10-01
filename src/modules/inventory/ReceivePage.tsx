import { FileScan, PackagePlus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Badge, Banner, Button, Card, CardHeader, Checkbox, cn, Layout, Page, Select, Spinner, TextArea, TextField, useToast } from "@/components/ui";
import { useBusiness } from "@/components/layout/AppFrame";
import { addDays, formatMoney, formatUnits, todayLima, extraConcentration } from "@/lib/format";
import type { DosageForm, ProductStock } from "@/lib/types";
import { usePosProducts } from "@/modules/pos/api";
import { exactCodeMatch, searchProducts } from "@/modules/pos/search";
import { useReceiveInvoice, useSuppliers } from "./api";
import { detectIgvIncluded, expiryDate, FOUND_SCORE, linePrice, matchInvoice, readInvoice, REVIEW_SCORE, type InvoiceData, type InvoiceLine } from "./invoice";

/** Producto que no existe y se creará al registrar el ingreso. */
type Draft = {
  name: string; generic_name: string | null; form: DosageForm; laboratory: string | null; presentation: string;
  units_per_pack: number; price_unit: string; price_pack: string; barcode: string;
};

/** Línea leída de la factura: found = enlazada sola; review = hay que confirmar; new = se creará. */
type Source = { line: InvoiceLine; status: "found" | "review" | "new"; suggestions: ProductStock[] };

type Row = {
  key: number; product: ProductStock | null; draft: Draft | null; src: Source | null; confirmed: boolean;
  lot: string; expiry: string; qty: string; unit: "caja" | "unidad"; cost: string;
};

const SUPPLIER_NEW = "__nuevo";

const packOf = (r: Row) => r.product?.units_per_pack ?? r.draft?.units_per_pack ?? 1;
const toUnits = (r: Row) => (Number(r.qty) || 0) * (r.unit === "caja" ? packOf(r) : 1);
const trim4 = (n: number) => String(Math.round(n * 10000) / 10000);

function ProductPicker({ onPick, autoFocus, placeholder }: { onPick: (p: ProductStock) => void; autoFocus?: boolean; placeholder?: string }) {
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
        autoFocus={autoFocus}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          if (e.key === "Enter") { e.preventDefault(); const p = exactCodeMatch(data, q) ?? results[active]; if (p) pick(p); }
        }}
        placeholder={placeholder ?? "Agregar producto: nombre, principio activo o código de barras"}
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

/** Fila a partir de una línea de la factura, enlazada a un producto del catálogo o como producto nuevo. */
function rowFromLine(line: InvoiceLine, product: ProductStock | null, src: Source, key = nextKey++): Row {
  const linePack = Math.max(1, Math.round(line.units_per_pack || 1));
  const price = linePrice(line);
  const base = { key, src, confirmed: src.status !== "review", lot: (line.lot ?? "").toUpperCase().trim(), expiry: expiryDate(line.expiry) };
  if (!product) {
    const unitWord = /^FCO/i.test(line.unit ?? "") ? "Frasco" : /^TUB/i.test(line.unit ?? "") ? "Tubo" : "Caja";
    return {
      ...base, product: null,
      draft: {
        name: line.name.toUpperCase(), generic_name: line.generic_name, form: line.form, laboratory: line.laboratory,
        presentation: linePack > 1 ? `${unitWord} x ${linePack}` : unitWord, units_per_pack: linePack, price_unit: "", price_pack: "", barcode: "",
      },
      qty: String(line.quantity), unit: linePack > 1 ? "caja" : "unidad", cost: trim4(price),
    };
  }
  // La caja de la factura es la misma del catálogo: se registra en cajas. Si no, en unidades.
  if (product.units_per_pack === linePack) {
    return { ...base, product, draft: null, qty: String(line.quantity), unit: linePack > 1 ? "caja" : "unidad", cost: trim4(price) };
  }
  return { ...base, product, draft: null, qty: String(line.quantity * linePack), unit: "unidad", cost: trim4(price / linePack) };
}

export function ReceivePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const { data: products = [] } = usePosProducts();
  const { data: suppliers = [] } = useSuppliers();
  const { data: business } = useBusiness();
  const receive = useReceiveInvoice();
  const [supplier, setSupplier] = useState("");
  const [newSupplier, setNewSupplier] = useState<{ name: string; ruc: string | null } | null>(null);
  const [invoice, setInvoice] = useState("");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [doc, setDoc] = useState<InvoiceData | null>(null);
  const [igvIncluded, setIgvIncluded] = useState(false);
  const [duplicate, setDuplicate] = useState<{ number: number } | null>(null);
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [reading, setReading] = useState(false);
  const [changing, setChanging] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const preloaded = useRef(false);
  const igvFactor = 1 + Number(business?.igv_rate ?? 18) / 100;

  /** Costo por unidad sin IGV: lo que se guarda. Solo las líneas de la factura traen IGV (si está marcado). */
  const costPerUnit = (r: Row) => {
    const perUnit = (Number(r.cost) || 0) / (r.unit === "caja" ? packOf(r) : 1);
    return r.src && igvIncluded && !r.product?.igv_exempt ? perUnit / igvFactor : perUnit;
  };

  const addProduct = (p: ProductStock) =>
    setRows((r) => [...r, { key: nextKey++, product: p, draft: null, src: null, confirmed: true, lot: "", expiry: addDays(todayLima(), 365), qty: "1", unit: p.units_per_pack > 1 ? "caja" : "unidad", cost: (Number(p.cost_unit) * (p.units_per_pack > 1 ? p.units_per_pack : 1)).toFixed(2) }]);

  // /ingresos/nuevo?producto=<id> precarga ese producto.
  useEffect(() => {
    const id = params.get("producto");
    const p = id && products.find((x) => x.id === id);
    if (p && !preloaded.current) { preloaded.current = true; addProduct(p); }
  }, [params, products]);

  const update = (key: number, patch: Partial<Row>) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const updateDraft = (key: number, patch: Partial<Draft>) => setRows((r) => r.map((x) => (x.key === key && x.draft ? { ...x, draft: { ...x.draft, ...patch } } : x)));
  /** Cambia el producto de una línea de la factura (o la pasa a producto nuevo con null). */
  const relink = (r: Row, product: ProductStock | null) => {
    if (!r.src) return;
    setRows((all) => all.map((x) => (x.key === r.key ? { ...rowFromLine(r.src!.line, product, r.src!, r.key), confirmed: true } : x)));
    setChanging(null);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    try {
      const inv = await readInvoice(file);
      const match = await matchInvoice(inv);
      const byId = new Map(products.map((p) => [p.id, p]));
      const read = inv.items.map((line, i) => {
        const m = match.items[i];
        const suggestions = (m?.candidates ?? []).map((c) => byId.get(c.id)).filter((p): p is ProductStock => Boolean(p));
        const top = m?.candidates[0];
        const mapped = m?.mapped ? byId.get(m.mapped) : undefined;
        if (mapped) return rowFromLine(line, mapped, { line, status: "found", suggestions });
        if (top && top.score >= FOUND_SCORE && suggestions[0]) return rowFromLine(line, suggestions[0], { line, status: "found", suggestions });
        if (top && top.score >= REVIEW_SCORE && suggestions.length) return rowFromLine(line, null, { line, status: "review", suggestions });
        return rowFromLine(line, null, { line, status: "new", suggestions });
      });
      setRows((r) => [...r, ...read]);
      setDoc(inv);
      setIgvIncluded(detectIgvIncluded(inv) ?? false);
      if (inv.invoice_number && !invoice) setInvoice(inv.invoice_number);
      if (match.supplier) { setSupplier(match.supplier.id); setNewSupplier(null); }
      else if (inv.supplier_name && !supplier) { setNewSupplier({ name: inv.supplier_name.toUpperCase(), ruc: inv.supplier_ruc }); setSupplier(SUPPLIER_NEW); }
      setDuplicate(match.duplicate);
      setAllowDuplicate(false);
      const pending = read.filter((r) => r.src?.status !== "found").length;
      toast(`${read.length} productos leídos${pending ? ` · ${pending} por revisar` : ""}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { error: true });
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const total = rows.reduce((n, r) => n + toUnits(r) * costPerUnit(r), 0);
  const today = todayLima();
  const docSubtotal = doc?.subtotal ?? null;
  const subtotalOff = docSubtotal != null && Math.abs(total - docSubtotal) > Math.max(1, docSubtotal * 0.01);

  const submit = () => {
    if (rows.length === 0) return toast("Agrega al menos un producto", { error: true });
    const unconfirmed = rows.find((r) => !r.confirmed);
    if (unconfirmed) return toast(`Confirma el producto de “${unconfirmed.src?.line.description}”`, { error: true });
    const bad = rows.find((r) => !r.lot.trim() || !r.expiry || toUnits(r) <= 0);
    if (bad) return toast(`Completa el lote, el vencimiento y la cantidad de ${bad.product?.name ?? bad.draft?.name}`, { error: true });
    const noPrice = rows.find((r) => r.draft && (!r.draft.name.trim() || !(Number(r.draft.price_unit) > 0)));
    if (noPrice) return toast(`Indica el nombre y el precio de venta de ${noPrice.draft?.name || "el producto nuevo"}`, { error: true });
    if (duplicate && !allowDuplicate) return toast(`Esta factura ya se registró en el ingreso #${duplicate.number}`, { error: true });
    receive.mutate(
      {
        supplier_id: supplier && supplier !== SUPPLIER_NEW ? supplier : null,
        supplier: supplier === SUPPLIER_NEW ? newSupplier : null,
        invoice_number: invoice, note, allow_duplicate: allowDuplicate,
        items: rows.map((r) => ({
          product_id: r.product?.id,
          new_product: r.draft ? {
            name: r.draft.name, generic_name: r.draft.generic_name, form: r.draft.form, presentation: r.draft.presentation || null,
            laboratory: r.draft.laboratory, barcode: r.draft.barcode.trim() || null, units_per_pack: r.draft.units_per_pack, price_unit: Number(r.draft.price_unit),
            price_pack: r.draft.price_pack ? Number(r.draft.price_pack) : null,
          } : undefined,
          supplier_code: r.src?.line.code ?? null,
          lot_number: r.lot, expiry_date: r.expiry, units: toUnits(r), cost_unit: Math.round(costPerUnit(r) * 10000) / 10000,
        })),
      },
      { onSuccess: (p) => { toast(`Ingreso #${p.number} registrado`); navigate("/ingresos"); }, onError: (e) => toast(e.message, { error: true }) },
    );
  };

  const supplierOptions = [
    ...(newSupplier ? [{ value: SUPPLIER_NEW, label: `${newSupplier.name} (nuevo)` }] : []),
    ...suppliers.map((s) => ({ value: s.id, label: s.name })),
  ];
  const fromInvoice = rows.some((r) => r.src);

  return (
    <Page title="Nuevo ingreso" breadcrumbs={[{ label: "Ingresos", to: "/ingresos" }]} largeTitle width="full"
      actions={
        <>
          <Button icon={FileScan} onClick={() => fileRef.current?.click()} loading={reading}>Leer factura</Button>
          <Button variant="primary" icon={PackagePlus} onClick={submit} loading={receive.isPending} disabled={reading}>Registrar ingreso</Button>
        </>
      }>
      <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      <Layout
        aside={
          <>
            <Card>
              <CardHeader title="Documento" />
              <div className="space-y-3">
                <Select label="Proveedor" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Sin proveedor" options={supplierOptions}
                  help={supplier === SUPPLIER_NEW ? "Se creará al registrar el ingreso." : undefined} />
                <TextField label="N.° de factura o guía" value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder="F001-000123" />
                {fromInvoice && (
                  <Checkbox label="Los precios de la factura incluyen IGV" checked={igvIncluded} onChange={(e) => setIgvIncluded(e.target.checked)}
                    help="Se detecta comparando las líneas con el subtotal. El costo se guarda sin IGV." />
                )}
                <TextArea label="Nota" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </Card>
            <Card>
              <CardHeader title="Resumen" />
              <p className="text-ink-secondary">{rows.length} productos · {rows.reduce((n, r) => n + toUnits(r), 0)} unidades</p>
              <p className="mt-1 text-[22px] font-[650] tabular-nums">{formatMoney(total)}</p>
              <p className="text-[12px] text-ink-tertiary">Costo total del ingreso (sin IGV)</p>
              {docSubtotal != null && (
                <p className={cn("mt-2 text-[12px]", subtotalOff ? "font-[550] text-warning" : "text-ink-secondary")}>
                  Subtotal de la factura: {formatMoney(docSubtotal)}{subtotalOff ? " · no cuadra, revisa cantidades y costos" : " · cuadra"}
                </p>
              )}
            </Card>
          </>
        }
      >
        {duplicate && (
          <Banner tone="critical" title={`Esta factura ya se registró en el ingreso #${duplicate.number}`}>
            <Checkbox label="Registrarla de nuevo de todos modos" checked={allowDuplicate} onChange={(e) => setAllowDuplicate(e.target.checked)} />
          </Banner>
        )}
        {reading && (
          <Card>
            <div className="flex items-center gap-3 py-2">
              <Spinner />
              <div>
                <p className="font-[550]">Leyendo la factura…</p>
                <p className="text-[12px] text-ink-secondary">Suele tardar entre 10 y 30 segundos.</p>
              </div>
            </div>
          </Card>
        )}
        <Card>
          <ProductPicker onPick={addProduct} />
          {rows.length === 0 ? (
            <div className="py-10 text-center text-ink-secondary">
              <p>Busca o escanea los productos que llegaron,</p>
              <p>o usa <strong className="text-ink">Leer factura</strong> con una foto o PDF de la factura del proveedor.</p>
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {rows.map((r) => {
                const days = r.expiry ? Math.round((new Date(`${r.expiry}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86400000) : null;
                const line = r.src?.line;
                const linePack = line ? Math.max(1, Math.round(line.units_per_pack || 1)) : null;
                const packMismatch = r.product && linePack != null && r.product.units_per_pack !== linePack;
                const others = r.src?.suggestions.filter((s) => s.id !== r.product?.id).slice(0, 3) ?? [];
                const net = costPerUnit(r);
                const margin = r.draft && Number(r.draft.price_unit) > 0 ? Math.round((1 - net / Number(r.draft.price_unit)) * 100) : null;
                return (
                  <li key={r.key} className="py-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        {r.product ? (
                          <>
                            <p className="font-[550]">
                              {r.product.name} {extraConcentration(r.product.name, r.product.concentration) && <span className="font-normal text-ink-secondary">{extraConcentration(r.product.name, r.product.concentration)}</span>}
                              {r.src && <Badge tone={r.src.status === "found" ? "success" : "info"} className="ml-2 align-middle">{r.src.status === "found" ? "Encontrado" : "Elegido"}</Badge>}
                            </p>
                            <p className="text-[12px] text-ink-secondary">{r.product.presentation} · stock actual {formatUnits(r.product.stock, r.product.units_per_pack)}</p>
                          </>
                        ) : (
                          <p className="font-[550]">
                            {r.draft?.name}
                            {r.confirmed ? <Badge tone="brand" className="ml-2 align-middle">Producto nuevo</Badge> : <Badge tone="warning" className="ml-2 align-middle">Revisar</Badge>}
                          </p>
                        )}
                        {line && (
                          <p className="text-[12px] text-ink-tertiary">
                            Factura: {line.code ? `${line.code} · ` : ""}{line.description} · {line.quantity} {line.unit ?? ""} × {formatMoney(linePrice(line))}
                          </p>
                        )}
                      </div>
                      {r.src && <Button variant="plain" onClick={() => setChanging(changing === r.key ? null : r.key)}>{changing === r.key ? "Cancelar" : "Cambiar"}</Button>}
                      <Button variant="plain" size="icon" icon={Trash2} onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>Quitar</Button>
                    </div>

                    {r.src && !r.confirmed && (
                      <div className="mt-2 rounded-[12px] bg-warning-soft px-3 py-2.5">
                        <p className="text-[13px] font-[550] text-warning">¿Es alguno de estos productos?</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {r.src.suggestions.slice(0, 3).map((s) => (
                            <Button key={s.id} size="sm" onClick={() => relink(r, s)}>{s.name}{s.presentation ? ` · ${s.presentation}` : ""}</Button>
                          ))}
                          <Button size="sm" variant="primary" onClick={() => update(r.key, { confirmed: true })}>No, es un producto nuevo</Button>
                        </div>
                      </div>
                    )}

                    {changing === r.key && (
                      <div className="mt-2 space-y-2 rounded-[12px] bg-surface-muted p-3">
                        <ProductPicker autoFocus placeholder="Buscar el producto correcto en el catálogo" onPick={(p) => relink(r, p)} />
                        <div className="flex flex-wrap gap-2">
                          {others.map((s) => <Button key={s.id} size="sm" onClick={() => relink(r, s)}>{s.name}</Button>)}
                          {r.product && <Button size="sm" variant="plain" onClick={() => relink(r, null)}>Crear como producto nuevo</Button>}
                        </div>
                      </div>
                    )}

                    {packMismatch && (
                      <p className="mt-1 text-[12px] font-[550] text-warning">
                        La factura trae {line?.unit ?? "cajas"} x{linePack}; en el catálogo la caja es x{r.product!.units_per_pack}. Se registra en unidades: revisa la cantidad.
                      </p>
                    )}

                    {r.draft && r.confirmed && (
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-[1fr_120px_140px_140px]">
                        <TextField label="Nombre del producto nuevo" className="col-span-2 sm:col-span-1" value={r.draft.name} onChange={(e) => updateDraft(r.key, { name: e.target.value.toUpperCase() })} />
                        <TextField label="Unidades por caja" type="number" min="1" value={r.draft.units_per_pack}
                          onChange={(e) => updateDraft(r.key, { units_per_pack: Math.max(1, Number(e.target.value) || 1) })} />
                        <TextField label="Precio venta unidad" type="number" min="0" step="0.10" prefix="S/" value={r.draft.price_unit}
                          error={r.draft.price_unit === "" ? "Obligatorio" : undefined}
                          help={margin !== null ? `Margen ${margin} %` : `Costo ${formatMoney(net)} c/u`}
                          onChange={(e) => updateDraft(r.key, { price_unit: e.target.value })} />
                        {r.draft.units_per_pack > 1 ? (
                          <TextField label="Precio venta caja" type="number" min="0" step="0.10" prefix="S/" value={r.draft.price_pack} placeholder="Opcional"
                            onChange={(e) => updateDraft(r.key, { price_pack: e.target.value })} />
                        ) : <div className="hidden sm:block" />}
                        <TextField label="Código de barras" className="col-span-2 sm:col-span-1" value={r.draft.barcode} placeholder="Escanéalo o escríbelo"
                          onChange={(e) => updateDraft(r.key, { barcode: e.target.value.replace(/\s/g, "") })}
                          onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} />
                      </div>
                    )}

                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-[1fr_150px_110px_120px_130px]">
                      <TextField label="Lote" value={r.lot} onChange={(e) => update(r.key, { lot: e.target.value.toUpperCase() })} placeholder="L2409" />
                      <TextField label="Vencimiento" type="date" value={r.expiry} min={today} onChange={(e) => update(r.key, { expiry: e.target.value })}
                        error={days !== null && days < 90 ? (days < 0 ? "Ya está vencido" : `Vence en ${days} días`) : undefined} />
                      <TextField label="Cantidad" type="number" min="1" value={r.qty} onChange={(e) => update(r.key, { qty: e.target.value })} />
                      {packOf(r) > 1 ? (
                        <Select label="Unidad" value={r.unit} onChange={(e) => {
                          const unit = e.target.value as Row["unit"];
                          const factor = unit === "caja" ? packOf(r) : 1 / packOf(r);
                          update(r.key, { unit, cost: trim4((Number(r.cost) || 0) * factor) });
                        }} options={[{ value: "caja", label: `Cajas x${packOf(r)}` }, { value: "unidad", label: "Unidades" }]} />
                      ) : <div className="hidden sm:block" />}
                      <TextField label={`Costo por ${r.unit}`} type="number" min="0" step="0.01" prefix="S/" value={r.cost} onChange={(e) => update(r.key, { cost: e.target.value })}
                        help={r.src && igvIncluded && !r.product?.igv_exempt ? "Con IGV" : undefined} />
                    </div>
                    <p className="mt-1 text-[12px] text-ink-secondary">= {toUnits(r)} unidades · {formatMoney(toUnits(r) * net)} · {formatMoney(net)} c/u sin IGV</p>
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
