import { Receipt } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Badge, Card, cn, EmptyState, IndexTable, Page, Select, type Column } from "@/components/ui";
import { addDays, formatDateTime, formatMoney, paymentLabels, todayLima } from "@/lib/format";
import { useIsAdmin } from "@/modules/auth/AuthProvider";
import { ticketNumber } from "@/modules/pos/Ticket";
import { PAGE_SIZE, useSales, useSaleTotals, type SaleFilters, type SaleRow } from "./api";

const presets = [
  { label: "Hoy", days: 0 },
  { label: "Ayer", days: -1 },
  { label: "7 días", days: 7 },
  { label: "30 días", days: 30 },
];

export function SalesPage() {
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const today = todayLima();
  const [f, setF] = useState<SaleFilters>({ from: today, to: today, status: "todas", method: "", search: "", page: 1 });
  const set = (patch: Partial<SaleFilters>) => setF({ ...f, page: 1, ...patch });
  const { data, isLoading } = useSales(f);
  const totals = useSaleTotals(f);

  const applyPreset = (days: number) =>
    days === 0 ? set({ from: today, to: today }) : days === -1 ? set({ from: addDays(today, -1), to: addDays(today, -1) }) : set({ from: addDays(today, -(days - 1)), to: today });
  const activePreset = presets.find((p) => (p.days === 0 ? f.from === today && f.to === today : p.days === -1 ? f.from === addDays(today, -1) && f.to === f.from : f.to === today && f.from === addDays(today, -(p.days - 1))));

  const columns: Column<SaleRow>[] = [
    { key: "n", header: "Ticket", render: (s) => <span className="font-[650] tabular-nums">{ticketNumber(s.number)}</span> },
    { key: "d", header: "Fecha", render: (s) => formatDateTime(s.created_at) },
    { key: "c", header: "Cliente", render: (s) => s.customer_name || s.customer_doc || <span className="text-ink-tertiary">—</span> },
    // El cajero solo ve sus propias ventas (lo filtra el servidor): la columna sobra.
    ...(isAdmin ? [{ key: "u", header: "Cajero", render: (s: SaleRow) => s.cashier ?? <span className="text-ink-tertiary">—</span> }] : []),
    { key: "m", header: "Pago", render: (s) => paymentLabels[s.payment_method] },
    { key: "s", header: "Estado", render: (s) => (s.status === "anulada" ? <Badge tone="critical">Anulada</Badge> : <Badge tone="success">Completada</Badge>) },
    { key: "i", header: "Artículos", align: "right", render: (s) => s.item_count },
    { key: "t", header: "Total", align: "right", render: (s) => <span className={cn("tabular-nums", s.status === "anulada" && "text-ink-tertiary line-through")}>{formatMoney(s.total)}</span> },
  ];

  return (
    <Page icon={Receipt} title={isAdmin ? "Ventas" : "Mis ventas"} subtitle={isAdmin ? undefined : "Solo ves las ventas que registraste tú."}>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="flex rounded-[10px] bg-surface-pressed/70 p-0.5">
          {presets.map((p) => (
            <button key={p.label} type="button" onClick={() => applyPreset(p.days)} className={cn("h-7 rounded-[8px] px-2.5 text-[12px] font-[550]", activePreset === p ? "bg-white shadow-button" : "text-ink-secondary")}>{p.label}</button>
          ))}
        </div>
        <label className="text-[12px] text-ink-secondary">Desde <input type="date" value={f.from} max={f.to} onChange={(e) => set({ from: e.target.value })} className="ml-1 h-7 rounded-[8px] px-2 shadow-field" /></label>
        <label className="text-[12px] text-ink-secondary">Hasta <input type="date" value={f.to} min={f.from} max={today} onChange={(e) => set({ to: e.target.value })} className="ml-1 h-7 rounded-[8px] px-2 shadow-field" /></label>
        <Select hideLabel label="Pago" value={f.method} onChange={(e) => set({ method: e.target.value })} placeholder="Todos los pagos" options={Object.entries(paymentLabels).map(([value, label]) => ({ value, label }))} className="w-40" />
      </div>

      <Card padded={false} className="mb-3 grid grid-cols-3 divide-x divide-border">
        <div className="px-4 py-3"><p className="text-[12px] text-ink-secondary">Total vendido</p><p className="text-[20px] font-[650] tabular-nums">{formatMoney(totals.data?.total)}</p></div>
        <div className="px-4 py-3"><p className="text-[12px] text-ink-secondary">Ventas</p><p className="text-[20px] font-[650] tabular-nums">{totals.data?.count ?? "—"}</p></div>
        <div className="px-4 py-3"><p className="text-[12px] text-ink-secondary">Anuladas</p><p className="text-[20px] font-[650] tabular-nums">{totals.data?.voided ?? "—"}</p></div>
      </Card>

      <IndexTable
        rows={data?.rows ?? []}
        columns={columns}
        getId={(s) => s.id}
        loading={isLoading}
        selectable={false}
        onRowClick={(s) => navigate(`/ventas/${s.id}`)}
        resourceName={{ singular: "venta", plural: "ventas" }}
        pagination={{ page: f.page, pageSize: PAGE_SIZE, total: data?.count ?? 0, onChange: (page) => setF({ ...f, page }) }}
        toolbar={
          <div className="flex items-center gap-2 px-2 py-1.5">
            <div className="flex gap-0.5">
              {(["todas", "completada", "anulada"] as const).map((s) => (
                <button key={s} type="button" onClick={() => set({ status: s })} className={cn("h-7 rounded-[8px] px-2.5 text-[12px] font-[550] capitalize", f.status === s ? "bg-surface-pressed" : "text-ink-secondary hover:bg-surface-hover")}>
                  {s === "todas" ? "Todas" : s === "completada" ? "Completadas" : "Anuladas"}
                </button>
              ))}
            </div>
            <input type="search" value={f.search} onChange={(e) => set({ search: e.target.value })} placeholder="N.° de ticket, cliente o DNI" aria-label="Buscar ventas"
              className="ml-auto h-7 w-full max-w-[240px] rounded-[8px] bg-white px-2.5 text-[12px] shadow-field outline-none focus:shadow-[0_0_0_2px_var(--color-brand)]" />
          </div>
        }
        empty={<EmptyState icon={Receipt} title="No hay ventas en este periodo" description="Cambia las fechas o los filtros." />}
      />
    </Page>
  );
}
