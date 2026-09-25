import { PackagePlus, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Badge, Banner, Button, Card, CardHeader, Checkbox, Layout, Modal, Page, Select, Skeleton, TextArea, TextField, useToast } from "@/components/ui";
import { daysUntil, expiryLabel, formatLotDate, formatMoney, formatUnits, formLabels } from "@/lib/format";
import type { DosageForm, Lot } from "@/lib/types";
import { useIsAdmin } from "@/modules/auth/AuthProvider";
import { useCategories } from "@/modules/pos/api";
import { useAdjustLot, useProduct, useProductLots, useSaveProduct, type ProductDraft } from "./api";

const blank: ProductDraft = {
  name: "", generic_name: "", concentration: "", form: "tableta", presentation: "", laboratory: "", category_id: null, barcode: "", code: "",
  units_per_pack: 1, sell_by_unit: true, price_unit: 0, price_pack: null, min_stock: 0, requires_prescription: false, is_controlled: false,
  igv_exempt: false, location: "", is_active: true,
};

function AdjustModal({ lot, perPack, onClose }: { lot: Lot | null; perPack: number; onClose: () => void }) {
  const adjust = useAdjustLot();
  const toast = useToast();
  const [qty, setQty] = useState("");
  const [type, setType] = useState<"ajuste" | "vencido" | "merma">("ajuste");
  const [note, setNote] = useState("");
  useEffect(() => { if (lot) { setQty(String(lot.quantity)); setType((daysUntil(lot.expiry_date) ?? 1) < 0 ? "vencido" : "ajuste"); setNote(""); } }, [lot]);
  if (!lot) return null;
  return (
    <Modal open onClose={onClose} title={`Ajustar lote ${lot.lot_number}`} size="sm"
      primaryAction={{
        label: "Guardar ajuste", loading: adjust.isPending, disabled: qty === "",
        onClick: () => adjust.mutate({ lot: lot.id, quantity: Number(qty), type, note }, {
          onSuccess: () => { toast("Lote ajustado"); onClose(); },
          onError: (e) => toast(e.message, { error: true }),
        }),
      }}>
      <div className="space-y-3">
        <p className="text-ink-secondary">Stock actual: <strong className="text-ink">{formatUnits(lot.quantity, perPack)}</strong> ({lot.quantity} unidades)</p>
        <Select label="Motivo" value={type} onChange={(e) => setType(e.target.value as typeof type)}
          options={[{ value: "ajuste", label: "Conteo físico / corrección" }, { value: "vencido", label: "Baja por vencimiento" }, { value: "merma", label: "Merma (roto, dañado, perdido)" }]} />
        <TextField label="Nueva cantidad (unidades)" type="number" min="0" value={qty} onChange={(e) => setQty(e.target.value)}
          help={qty !== "" ? `Diferencia: ${Number(qty) - lot.quantity > 0 ? "+" : ""}${Number(qty) - lot.quantity} unidades` : undefined} />
        <TextArea label="Nota" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Opcional" />
      </div>
    </Modal>
  );
}

export function ProductFormPage() {
  const { id } = useParams();
  const isNew = !id || id === "nuevo";
  const navigate = useNavigate();
  const toast = useToast();
  const isAdmin = useIsAdmin();
  const { data: product, isLoading } = useProduct(isNew ? undefined : id);
  const { data: lots = [] } = useProductLots(isNew ? undefined : id);
  const { data: categories = [] } = useCategories();
  const save = useSaveProduct();
  const [d, setD] = useState<ProductDraft>(blank);
  const [adjusting, setAdjusting] = useState<Lot | null>(null);

  useEffect(() => {
    if (product) {
      const { category_name: _c, category_color: _cc, stock: _s, expired_units: _e, next_expiry: _n, lot_count: _l, stock_value: _v, is_low_stock: _b, created_at: _ca, ...rest } = product;
      setD({ ...blank, ...rest });
    }
  }, [product]);

  const crumbs = [{ label: "Productos", to: "/productos" }];
  if (!isNew && isLoading) return <Page title="Producto" breadcrumbs={crumbs}><Skeleton className="h-96" /></Page>;

  const set = (patch: Partial<ProductDraft>) => setD({ ...d, ...patch });
  const text = (k: keyof ProductDraft) => ({ value: (d[k] as string | null) ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement>) => set({ [k]: e.target.value }), disabled: !isAdmin });
  const packPrice = d.price_pack ?? Number(d.price_unit) * d.units_per_pack;
  const margin = product && Number(d.price_unit) > 0 ? Math.round((1 - Number(product.cost_unit) / Number(d.price_unit)) * 100) : null;

  const submit = () => {
    if (!d.name.trim()) return toast("Escribe el nombre del producto", { error: true });
    save.mutate(d, {
      onSuccess: (newId) => { toast(isNew ? "Producto creado" : "Producto guardado"); if (isNew) navigate(`/productos/${newId}`, { replace: true }); },
      onError: (e) => toast(e.message, { error: true }),
    });
  };

  return (
    <Page title={isNew ? "Nuevo producto" : d.name} breadcrumbs={crumbs} largeTitle
      titleMeta={product && (product.stock === 0 ? <Badge tone="critical">Agotado</Badge> : product.is_low_stock ? <Badge tone="warning">Stock bajo</Badge> : null)}
      actions={
        <>
          {!isNew && <Button icon={PackagePlus} to={`/ingresos/nuevo?producto=${id}`}>Registrar ingreso</Button>}
          {isAdmin && <Button variant="primary" onClick={submit} loading={save.isPending}>Guardar</Button>}
        </>
      }>
      {!isAdmin && <div className="mb-4"><Banner tone="info">Solo un administrador puede editar productos.</Banner></div>}
      <Layout
        aside={
          <>
            <Card>
              <CardHeader title="Estado" />
              <Select label="Estado" hideLabel value={d.is_active ? "1" : "0"} onChange={(e) => set({ is_active: e.target.value === "1" })} disabled={!isAdmin}
                options={[{ value: "1", label: "Activo (se vende)" }, { value: "0", label: "Inactivo" }]} />
              <div className="mt-3 space-y-2">
                <Checkbox label="Requiere receta médica" checked={d.requires_prescription} onChange={(e) => set({ requires_prescription: e.target.checked })} disabled={!isAdmin} />
                <Checkbox label="Medicamento controlado" checked={d.is_controlled} onChange={(e) => set({ is_controlled: e.target.checked })} disabled={!isAdmin} />
                <Checkbox label="Exonerado de IGV" checked={d.igv_exempt} onChange={(e) => set({ igv_exempt: e.target.checked })} disabled={!isAdmin} />
              </div>
            </Card>
            <Card>
              <CardHeader title="Organización" />
              <div className="space-y-3">
                <Select label="Categoría" value={d.category_id ?? ""} onChange={(e) => set({ category_id: e.target.value || null })} placeholder="Sin categoría" disabled={!isAdmin}
                  options={categories.map((c) => ({ value: c.id, label: c.name }))} />
                <TextField label="Laboratorio" {...text("laboratory")} />
                <TextField label="Ubicación (estante)" {...text("location")} placeholder="A1" />
              </div>
            </Card>
            {product && (
              <Card>
                <CardHeader title="Stock" />
                <p className="text-[22px] font-[650]">{formatUnits(product.stock, product.units_per_pack)}</p>
                <p className="text-ink-secondary">{product.stock} unidades vendibles{product.expired_units > 0 && ` · ${product.expired_units} vencidas`}</p>
                {isAdmin && <p className="mt-2 text-ink-secondary">Costo promedio {formatMoney(product.cost_unit)} c/u · valor {formatMoney(product.stock_value)}</p>}
              </Card>
            )}
          </>
        }
      >
        <Card>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Nombre comercial" required className="sm:col-span-2" {...text("name")} placeholder="Panadol Antigripal" />
            <TextField label="Principio activo (genérico)" {...text("generic_name")} placeholder="Paracetamol" help="Sirve para encontrar equivalentes en la venta." />
            <TextField label="Concentración" {...text("concentration")} placeholder="500 mg" />
            <Select label="Forma farmacéutica" value={d.form} onChange={(e) => set({ form: e.target.value as DosageForm })} disabled={!isAdmin}
              options={Object.entries(formLabels).map(([value, label]) => ({ value, label }))} />
            <TextField label="Presentación" {...text("presentation")} placeholder="Caja x 100 tabletas" />
            <TextField label="Código de barras" {...text("barcode")} placeholder="Escanéalo aquí" />
            <TextField label="Código interno" {...text("code")} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Precio y unidades" />
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField label="Unidades por caja" type="number" min="1" value={d.units_per_pack} disabled={!isAdmin}
              onChange={(e) => set({ units_per_pack: Math.max(1, Number(e.target.value) || 1) })} help="1 si se vende por frasco/tubo." />
            <TextField label="Precio por unidad" type="number" min="0" step="0.01" prefix="S/" value={d.price_unit} disabled={!isAdmin}
              onChange={(e) => set({ price_unit: Number(e.target.value) })} help={margin !== null ? `Margen ${margin} %` : undefined} />
            {d.units_per_pack > 1 && (
              <TextField label="Precio por caja" type="number" min="0" step="0.01" prefix="S/" value={d.price_pack ?? ""} disabled={!isAdmin}
                placeholder={packPrice.toFixed(2)} onChange={(e) => set({ price_pack: e.target.value === "" ? null : Number(e.target.value) })} help="Vacío = unidad × cantidad." />
            )}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <TextField label="Stock mínimo (unidades)" type="number" min="0" value={d.min_stock} disabled={!isAdmin} onChange={(e) => set({ min_stock: Number(e.target.value) || 0 })}
              help="Avisa como “stock bajo” al llegar aquí." />
            {d.units_per_pack > 1 && (
              <div className="pt-6 sm:col-span-2">
                <Checkbox label="Se vende por unidad (fraccionado)" help="Desmárcalo si solo se vende la caja completa." checked={d.sell_by_unit} onChange={(e) => set({ sell_by_unit: e.target.checked })} disabled={!isAdmin} />
              </div>
            )}
          </div>
        </Card>

        {!isNew && (
          <Card padded={false}>
            <div className="px-4 pt-4"><CardHeader title="Lotes" description="La venta descuenta primero el lote que vence antes (FEFO)." /></div>
            {lots.filter((l) => l.quantity > 0).length === 0 ? (
              <p className="px-4 pb-4 text-ink-secondary">Sin stock. Registra un ingreso para agregar un lote.</p>
            ) : (
              <table className="w-full border-t border-border text-left">
                <thead><tr className="h-9 bg-surface-muted text-[12px] text-ink-secondary"><th className="pl-4">Lote</th><th>Vencimiento</th><th className="text-right">Stock</th><th className="text-right">Costo u.</th><th className="pr-4" /></tr></thead>
                <tbody>
                  {lots.filter((l) => l.quantity > 0).map((l) => {
                    const days = daysUntil(l.expiry_date);
                    return (
                      <tr key={l.id} className="h-11 border-t border-border">
                        <td className="pl-4 font-[550]">{l.lot_number}</td>
                        <td>{formatLotDate(l.expiry_date)} {days !== null && days <= 90 && <Badge tone={days < 0 ? "critical" : days <= 30 ? "critical" : "warning"} className="ml-1">{expiryLabel(days)}</Badge>}</td>
                        <td className="text-right tabular-nums">{formatUnits(l.quantity, d.units_per_pack)}</td>
                        <td className="text-right tabular-nums">{formatMoney(l.cost_unit)}</td>
                        <td className="pr-4 text-right">{isAdmin && <Button variant="plain" icon={SlidersHorizontal} onClick={() => setAdjusting(l)}>Ajustar</Button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>
        )}
      </Layout>
      <AdjustModal lot={adjusting} perPack={d.units_per_pack} onClose={() => setAdjusting(null)} />
    </Page>
  );
}
