import { createPortal } from "react-dom";
import { useBusiness } from "@/components/layout/AppFrame";
import { formatDateTime, formatMoney, paymentLabels } from "@/lib/format";
import type { SaleDetail } from "@/lib/types";

export const ticketNumber = (n: number) => `T001-${String(n).padStart(6, "0")}`;

/** Ticket de 80 mm. Se renderiza fuera de la app para que window.print() solo muestre esto. */
export function Ticket({ sale }: { sale: SaleDetail }) {
  const { data: b } = useBusiness();
  const row = "flex justify-between gap-2";
  return createPortal(
    <div id="ticket-print" aria-hidden className="pointer-events-none fixed -left-[9999px] top-0 bg-white font-mono text-[11px] leading-[1.35] text-black">
      <div className="text-center">
        <img src="/logo.png" alt="" className="mx-auto mb-1 size-[72px] grayscale" />
        <p className="text-[13px] font-bold">{b?.name ?? "Botica"}</p>
        {b?.ruc && <p>RUC {b.ruc}</p>}
        {b?.address && <p>{b.address}</p>}
        {b?.phone && <p>Tel. {b.phone}</p>}
        <p className="mt-1.5 font-bold">TICKET DE VENTA</p>
        <p>{ticketNumber(sale.number)}</p>
      </div>
      <div className="my-1.5 border-t border-dashed border-black" />
      <p>Fecha: {formatDateTime(sale.created_at)}</p>
      {sale.cashier && <p>Cajero: {sale.cashier}</p>}
      {sale.customer_doc && <p>Cliente: {sale.customer_name ?? ""} ({sale.customer_doc})</p>}
      <div className="my-1.5 border-t border-dashed border-black" />
      {sale.items.map((i) => (
        <div key={i.id} className="mb-1">
          <p className="font-bold">{i.product_name}</p>
          <div className={row}>
            <span>{i.quantity} {i.unit === "caja" ? (i.quantity === 1 ? "caja" : "cajas") : "u."} × {Number(i.unit_price).toFixed(2)}</span>
            <span>{Number(i.total).toFixed(2)}</span>
          </div>
        </div>
      ))}
      <div className="my-1.5 border-t border-dashed border-black" />
      <div className={row}><span>Op. gravada</span><span>{formatMoney(sale.subtotal)}</span></div>
      <div className={row}><span>IGV</span><span>{formatMoney(sale.igv)}</span></div>
      <div className={`${row} text-[13px] font-bold`}><span>TOTAL</span><span>{formatMoney(sale.total)}</span></div>
      <div className={row}><span>Pago</span><span>{paymentLabels[sale.payment_method]}</span></div>
      {sale.amount_received != null && (
        <>
          <div className={row}><span>Recibido</span><span>{formatMoney(sale.amount_received)}</span></div>
          <div className={row}><span>Vuelto</span><span>{formatMoney(sale.change_given)}</span></div>
        </>
      )}
      {sale.status === "anulada" && <p className="mt-1 text-center font-bold">*** VENTA ANULADA ***</p>}
      <div className="my-1.5 border-t border-dashed border-black" />
      <p className="text-center">{b?.ticket_footer}</p>
    </div>,
    document.body,
  );
}

export const printTicket = () => setTimeout(() => window.print(), 50);
