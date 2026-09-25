import { ClipboardList } from "lucide-react";
import { useState } from "react";
import { Badge, IndexTable, Page, Select, type Column, type Tone } from "@/components/ui";
import { formatDateTime, extraConcentration } from "@/lib/format";
import { usePosProducts } from "@/modules/pos/api";
import { useMovements, type MovementRow } from "./api";

const types: Record<MovementRow["type"], { label: string; tone: Tone }> = {
  compra: { label: "Ingreso", tone: "success" },
  venta: { label: "Venta", tone: "info" },
  anulacion: { label: "Anulación", tone: "attention" },
  ajuste: { label: "Ajuste", tone: "neutral" },
  vencido: { label: "Vencido", tone: "critical" },
  merma: { label: "Merma", tone: "warning" },
};

export function KardexPage() {
  const [productId, setProductId] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const { data: products = [] } = usePosProducts();
  const { data, isLoading } = useMovements({ productId: productId || undefined, type: type || undefined, page });

  const columns: Column<MovementRow>[] = [
    { key: "d", header: "Fecha", render: (m) => formatDateTime(m.created_at) },
    { key: "p", header: "Producto", render: (m) => <span className="font-[550]">{m.product_name} {extraConcentration(m.product_name, m.concentration) && <span className="font-normal text-ink-secondary">{extraConcentration(m.product_name, m.concentration)}</span>}</span> },
    { key: "t", header: "Movimiento", render: (m) => <Badge tone={types[m.type].tone}>{types[m.type].label}</Badge> },
    { key: "l", header: "Lote", render: (m) => m.lot_number ?? "—" },
    { key: "n", header: "Detalle", render: (m) => <span className="text-ink-secondary">{m.note ?? "—"}{m.user_name && ` · ${m.user_name}`}</span> },
    { key: "u", header: "Cantidad", align: "right", render: (m) => <span className={m.units > 0 ? "font-[550] text-success" : "font-[550] text-critical-strong"}>{m.units > 0 ? "+" : ""}{m.units}</span> },
    { key: "b", header: "Saldo", align: "right", render: (m) => <span className="tabular-nums">{m.balance}</span> },
  ];

  return (
    <Page icon={ClipboardList} title="Kardex" subtitle="Todos los movimientos de stock en unidades.">
      <div className="mb-3 flex flex-wrap gap-2">
        <Select hideLabel label="Producto" value={productId} onChange={(e) => { setProductId(e.target.value); setPage(1); }} placeholder="Todos los productos"
          options={products.map((p) => ({ value: p.id, label: `${p.name}${extraConcentration(p.name, p.concentration) ? ` ${p.concentration}` : ""}` }))} className="w-72" />
        <Select hideLabel label="Tipo" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} placeholder="Todos los movimientos"
          options={Object.entries(types).map(([value, t]) => ({ value, label: t.label }))} className="w-48" />
      </div>
      <IndexTable rows={data?.rows ?? []} columns={columns} getId={(m) => m.id} loading={isLoading} selectable={false}
        resourceName={{ singular: "movimiento", plural: "movimientos" }}
        pagination={{ page, pageSize: 50, total: data?.count ?? 0, onChange: setPage }}
        empty={<p className="px-4 py-8 text-center text-ink-secondary">Sin movimientos.</p>} />
    </Page>
  );
}
