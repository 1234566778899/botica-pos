import { PackagePlus, Plus } from "lucide-react";
import { Button, EmptyState, IndexTable, Page, type Column } from "@/components/ui";
import { formatDateTime, formatMoney } from "@/lib/format";
import { usePurchases, type PurchaseRow } from "./api";

export function PurchasesPage() {
  const { data = [], isLoading } = usePurchases();
  const columns: Column<PurchaseRow>[] = [
    { key: "n", header: "Ingreso", render: (r) => <span className="font-[650]">#{r.number}</span> },
    { key: "d", header: "Fecha", render: (r) => formatDateTime(r.created_at) },
    { key: "s", header: "Proveedor", render: (r) => r.supplier_name ?? <span className="text-ink-tertiary">—</span> },
    { key: "f", header: "Factura / guía", render: (r) => r.invoice_number ?? <span className="text-ink-tertiary">—</span> },
    { key: "u", header: "Registrado por", render: (r) => r.user_name ?? <span className="text-ink-tertiary">—</span> },
    { key: "i", header: "Productos", align: "right", render: (r) => `${r.item_count} · ${r.units} u.` },
    { key: "t", header: "Total (costo)", align: "right", render: (r) => <span className="tabular-nums">{formatMoney(r.total)}</span> },
  ];
  return (
    <Page icon={PackagePlus} title="Ingresos de mercadería" actions={<Button variant="primary" icon={Plus} to="/ingresos/nuevo">Nuevo ingreso</Button>}>
      <IndexTable rows={data} columns={columns} getId={(r) => r.id} loading={isLoading} selectable={false}
        resourceName={{ singular: "ingreso", plural: "ingresos" }}
        empty={<EmptyState icon={PackagePlus} title="Aún no hay ingresos" description="Registra la mercadería que llega de tus proveedores para sumar stock con su lote y vencimiento." action={<Button variant="primary" to="/ingresos/nuevo">Nuevo ingreso</Button>} />} />
    </Page>
  );
}
