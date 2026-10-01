import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Wallet } from "lucide-react";
import { useState } from "react";
import { Badge, Banner, Button, Card, CardHeader, cn, IndexTable, Layout, Page, Skeleton, TextArea, useToast, type Column } from "@/components/ui";
import { formatDateTime, formatMoney, paymentLabels } from "@/lib/format";
import { supabase, unwrap } from "@/lib/supabase";
import type { CashSummary } from "@/lib/types";
import { useCashCurrent } from "@/modules/pos/api";

type SessionRow = {
  id: string; opened_at: string; closed_at: string | null; opening_amount: number; expected_cash: number | null; counted_cash: number | null;
  cashier: string | null; sales_count: number; sales_total: number; note: string | null;
};

function MethodBreakdown({ s }: { s: CashSummary }) {
  return (
    <dl className="space-y-1.5">
      <div className="flex justify-between"><dt className="text-ink-secondary">Fondo inicial</dt><dd className="tabular-nums">{formatMoney(s.opening_amount)}</dd></div>
      {Object.entries(paymentLabels).map(([k, label]) => (
        <div key={k} className="flex justify-between"><dt className="text-ink-secondary">Ventas en {label.toLowerCase()}</dt><dd className="tabular-nums">{formatMoney(s.by_method[k as keyof typeof s.by_method] ?? 0)}</dd></div>
      ))}
      <div className="flex justify-between border-t border-border pt-1.5 font-[650]"><dt>Efectivo esperado en caja</dt><dd className="tabular-nums">{formatMoney(s.cash_expected)}</dd></div>
    </dl>
  );
}

function CloseCash({ session }: { session: CashSummary }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [closed, setClosed] = useState<CashSummary | null>(null);
  const close = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc("cash_close", { p_counted: Number(counted || 0), p_note: note })) as CashSummary,
    onSuccess: (s) => { setClosed(s); qc.invalidateQueries({ queryKey: ["cash-current"] }); qc.invalidateQueries({ queryKey: ["cash-sessions"] }); },
    // Pudo cerrarla antes desde el teléfono: recargar muestra el estado real.
    onError: (e) => { toast(e.message, { error: true }); qc.invalidateQueries({ queryKey: ["cash-current"] }); qc.invalidateQueries({ queryKey: ["cash-sessions"] }); },
  });
  const diff = counted === "" ? null : Number(counted) - session.cash_expected;

  if (closed) {
    const d = Number(closed.counted_cash) - Number(closed.expected_cash);
    return (
      <Banner tone={Math.abs(d) < 0.01 ? "success" : "warning"} title="Caja cerrada">
        Esperado {formatMoney(closed.expected_cash)} · contado {formatMoney(closed.counted_cash)} · {Math.abs(d) < 0.01 ? "cuadra exacto" : d > 0 ? `sobran ${formatMoney(d)}` : `faltan ${formatMoney(-d)}`}.
      </Banner>
    );
  }

  return (
    <Card>
      <CardHeader title="Cerrar caja" description="Cuenta el efectivo que hay en la caja (incluido el fondo inicial)." />
      <form onSubmit={(e) => { e.preventDefault(); close.mutate(); }} className="space-y-3">
        <div className="relative">
          <span className="absolute top-1/2 left-3 -translate-y-1/2 text-ink-secondary">S/</span>
          <input autoFocus inputMode="decimal" placeholder="0.00" value={counted} onChange={(e) => setCounted(e.target.value.replace(/[^\d.]/g, ""))} aria-label="Efectivo contado"
            className="h-11 w-full rounded-[12px] pr-3 pl-9 text-[18px] font-[650] shadow-field outline-none focus:shadow-[0_0_0_2px_var(--color-brand)]" />
        </div>
        {diff !== null && (
          <p className={cn("rounded-[10px] px-3 py-2 font-[550]", Math.abs(diff) < 0.01 ? "bg-success-soft text-success" : "bg-warning-soft text-warning")}>
            {Math.abs(diff) < 0.01 ? "La caja cuadra." : diff > 0 ? `Sobran ${formatMoney(diff)}` : `Faltan ${formatMoney(-diff)}`}
          </p>
        )}
        <TextArea label="Observaciones" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Opcional" />
        <Button type="submit" variant="primary" size="md" icon={Lock} loading={close.isPending} disabled={counted === ""} className="w-full justify-center">Cerrar caja</Button>
      </form>
    </Card>
  );
}

export function CashPage() {
  const current = useCashCurrent();
  const sessions = useQuery({
    queryKey: ["cash-sessions"],
    queryFn: async () => unwrap(await supabase.from("cash_session_list").select("*").order("opened_at", { ascending: false }).limit(60)) as SessionRow[],
  });

  const columns: Column<SessionRow>[] = [
    { key: "o", header: "Apertura", render: (r) => formatDateTime(r.opened_at) },
    { key: "c", header: "Cierre", render: (r) => (r.closed_at ? formatDateTime(r.closed_at) : <Badge tone="success">Abierta</Badge>) },
    { key: "u", header: "Cajero", render: (r) => r.cashier ?? "—" },
    { key: "n", header: "Ventas", align: "right", render: (r) => r.sales_count },
    { key: "t", header: "Vendido", align: "right", render: (r) => <span className="tabular-nums">{formatMoney(r.sales_total)}</span> },
    { key: "e", header: "Efectivo esperado", align: "right", render: (r) => (r.expected_cash == null ? "—" : <span className="tabular-nums">{formatMoney(r.expected_cash)}</span>) },
    {
      key: "d", header: "Diferencia", align: "right",
      render: (r) => {
        if (r.counted_cash == null || r.expected_cash == null) return "—";
        const d = Number(r.counted_cash) - Number(r.expected_cash);
        return <span className={cn("tabular-nums font-[550]", Math.abs(d) < 0.01 ? "text-success" : "text-warning")}>{Math.abs(d) < 0.01 ? "Cuadra" : `${d > 0 ? "+" : "−"}${formatMoney(Math.abs(d)).replace("−", "")}`}</span>;
      },
    },
  ];

  return (
    <Page icon={Wallet} title="Caja">
      {current.isLoading ? <Skeleton className="h-60" /> : current.data ? (
        <Layout aside={<CloseCash session={current.data} />}>
          <Card>
            <CardHeader title="Tu turno" description={`Abierto ${formatDateTime(current.data.opened_at)}`} actions={<Badge tone="success">Abierta</Badge>} />
            <div className="mb-4 grid grid-cols-3 gap-3">
              <div className="rounded-[14px] bg-surface-muted px-3 py-2.5"><p className="text-[12px] text-ink-secondary">Ventas</p><p className="text-[20px] font-[650] tabular-nums">{current.data.sales_count}</p></div>
              <div className="rounded-[14px] bg-surface-muted px-3 py-2.5"><p className="text-[12px] text-ink-secondary">Total vendido</p><p className="text-[20px] font-[650] tabular-nums">{formatMoney(current.data.sales_total)}</p></div>
              <div className="rounded-[14px] bg-surface-muted px-3 py-2.5"><p className="text-[12px] text-ink-secondary">Anuladas</p><p className="text-[20px] font-[650] tabular-nums">{current.data.voided_count}</p></div>
            </div>
            <MethodBreakdown s={current.data} />
          </Card>
        </Layout>
      ) : (
        <Banner tone="info" title="Tu caja está cerrada" action={<Button variant="primary" to="/vender">Abrir caja y vender</Button>}>
          Ábrela desde la pantalla de venta con el fondo inicial del turno. Cada usuario tiene su propia caja: tus ventas van a tu turno y lo cierras tú.
        </Banner>
      )}

      <h2 className="mt-6 mb-2 px-1 text-[14px] font-[650]">Turnos anteriores</h2>
      <IndexTable rows={sessions.data ?? []} columns={columns} getId={(r) => r.id} loading={sessions.isLoading} selectable={false}
        resourceName={{ singular: "turno", plural: "turnos" }} empty={<p className="px-4 py-8 text-center text-ink-secondary">Aún no hay turnos.</p>} />
    </Page>
  );
}
