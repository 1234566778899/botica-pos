import { Ban, Printer } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router";
import { Badge, Banner, Button, Card, CardHeader, Layout, Modal, Page, Skeleton, TextArea, useToast } from "@/components/ui";
import { formatDateTime, formatMoney, paymentLabels } from "@/lib/format";
import { useIsAdmin } from "@/modules/auth/AuthProvider";
import { printTicket, Ticket, ticketNumber } from "@/modules/pos/Ticket";
import { useSale, useVoidSale } from "./api";

export function SaleDetailPage() {
  const { id } = useParams();
  const { data: sale, isLoading, error } = useSale(id);
  const isAdmin = useIsAdmin();
  const voidSale = useVoidSale();
  const toast = useToast();
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");

  const crumbs = [{ label: "Ventas", to: "/ventas" }];
  if (isLoading) return <Page title="Venta" breadcrumbs={crumbs}><Skeleton className="h-80" /></Page>;
  if (error || !sale) return <Page title="Venta" breadcrumbs={crumbs}><Banner tone="critical">{error?.message ?? "Venta no encontrada"}</Banner></Page>;

  return (
    <Page title={ticketNumber(sale.number)} breadcrumbs={crumbs} largeTitle width="narrow"
      titleMeta={sale.status === "anulada" ? <Badge tone="critical">Anulada</Badge> : <Badge tone="success">Completada</Badge>}
      subtitle={`${formatDateTime(sale.created_at)}${sale.cashier ? ` · ${sale.cashier}` : ""}`}
      actions={
        <>
          <Button icon={Printer} onClick={printTicket}>Imprimir ticket</Button>
          {isAdmin && sale.status === "completada" && <Button variant="critical" icon={Ban} onClick={() => setVoiding(true)}>Anular venta</Button>}
        </>
      }>
      {sale.status === "anulada" && (
        <div className="mb-4"><Banner tone="critical" title="Venta anulada">{formatDateTime(sale.voided_at)} · {sale.void_reason}. El stock se devolvió a sus lotes.</Banner></div>
      )}
      <Layout
        aside={
          <>
            <Card>
              <CardHeader title="Pago" />
              <dl className="space-y-1.5">
                <div className="flex justify-between"><dt className="text-ink-secondary">Método</dt><dd>{paymentLabels[sale.payment_method]}</dd></div>
                {sale.amount_received != null && <div className="flex justify-between"><dt className="text-ink-secondary">Recibido</dt><dd>{formatMoney(sale.amount_received)}</dd></div>}
                {sale.change_given != null && <div className="flex justify-between"><dt className="text-ink-secondary">Vuelto</dt><dd>{formatMoney(sale.change_given)}</dd></div>}
              </dl>
            </Card>
            <Card>
              <CardHeader title="Cliente" />
              {sale.customer_doc ? <p>{sale.customer_name}<br /><span className="text-ink-secondary">{sale.customer_doc}</span></p> : <p className="text-ink-secondary">Venta sin cliente (público general)</p>}
            </Card>
          </>
        }
      >
        <Card padded={false}>
          <div className="px-4 pt-4"><CardHeader title={`${sale.item_count} artículos`} /></div>
          <ul className="divide-y divide-border border-t border-border">
            {sale.items.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="font-[550]">{i.product_name}</p>
                  {i.description && <p className="text-[12px] text-ink-secondary">{i.description}</p>}
                </div>
                <span className="text-ink-secondary tabular-nums">{i.quantity} {i.unit === "caja" ? (i.quantity === 1 ? "caja" : "cajas") : "u."} × {formatMoney(i.unit_price)}</span>
                <span className="w-24 text-right font-[550] tabular-nums">{formatMoney(i.total)}</span>
              </li>
            ))}
          </ul>
          <dl className="space-y-1 border-t border-border px-4 py-3">
            <div className="flex justify-between text-ink-secondary"><dt>Op. gravada</dt><dd className="tabular-nums">{formatMoney(sale.subtotal)}</dd></div>
            <div className="flex justify-between text-ink-secondary"><dt>IGV</dt><dd className="tabular-nums">{formatMoney(sale.igv)}</dd></div>
            {isAdmin && <div className="flex justify-between text-ink-secondary"><dt>Costo · utilidad</dt><dd className="tabular-nums">{formatMoney(sale.cost_total)} · {formatMoney(sale.total - sale.cost_total)}</dd></div>}
            <div className="flex justify-between pt-1 text-[16px] font-[650]"><dt>Total</dt><dd className="tabular-nums">{formatMoney(sale.total)}</dd></div>
          </dl>
        </Card>
      </Layout>

      <Modal open={voiding} onClose={() => setVoiding(false)} title={`Anular ${ticketNumber(sale.number)}`} size="sm"
        primaryAction={{
          label: "Anular venta", destructive: true, loading: voidSale.isPending, disabled: !reason.trim(),
          onClick: () => voidSale.mutate({ id: sale.id, reason }, {
            onSuccess: () => { toast("Venta anulada y stock devuelto"); setVoiding(false); },
            onError: (e) => toast(e.message, { error: true }),
          }),
        }}>
        <p className="mb-3 text-ink-secondary">Los productos vuelven al stock de sus mismos lotes. Esta acción no se puede deshacer.</p>
        <TextArea label="Motivo" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej. el cliente devolvió el producto" />
      </Modal>
      <Ticket sale={sale} />
    </Page>
  );
}
