import { Contact, Mail, Phone, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Badge, Banner, Button, Card, CardHeader, Layout, Modal, Page, Skeleton, useToast } from "@/components/ui";
import { formatDate, formatDateTime, formatMoney, paymentLabels, pluralize } from "@/lib/format";
import type { Customer } from "@/lib/types";
import { useIsAdmin, useStaff } from "@/modules/auth/AuthProvider";
import { ticketNumber } from "@/modules/pos/Ticket";
import { docLabel, toInput, useCustomer, useCustomerSales, useDeleteCustomer, useSaveCustomer, validateCustomer, type CustomerInput } from "./api";
import { CustomerFields } from "./CustomerForm";

const crumbs = [{ label: "Clientes", to: "/clientes" }];

export function CustomerPage() {
  const { id } = useParams();
  const { data: customer, isLoading, error } = useCustomer(id);
  if (isLoading) return <Page title="Cliente" breadcrumbs={crumbs}><Skeleton className="h-80" /></Page>;
  if (error || !customer) return <Page title="Cliente" breadcrumbs={crumbs}><Banner tone="critical">{error?.message ?? "Cliente no encontrado"}</Banner></Page>;
  return <CustomerDetail key={customer.id} customer={customer} />;
}

function CustomerDetail({ customer }: { customer: Customer }) {
  // null = sin cambios: se muestra lo guardado (y lo que otro usuario edite mientras tanto).
  const [draft, setDraft] = useState<CustomerInput | null>(null);
  const [touched, setTouched] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const save = useSaveCustomer();
  const remove = useDeleteCustomer();
  const isAdmin = useIsAdmin();
  const toast = useToast();
  const navigate = useNavigate();

  const saved = toInput(customer);
  const form = draft ?? saved;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(saved);

  const errors = touched ? validateCustomer(form) : {};
  const submit = () => {
    setTouched(true);
    if (Object.keys(validateCustomer(form)).length) return;
    save.mutate(form, {
      onSuccess: () => { setDraft(null); setTouched(false); toast("Cliente guardado"); },
      onError: (e) => toast(e.message, { error: true }),
    });
  };

  return (
    <Page title={customer.name} breadcrumbs={crumbs} largeTitle width="default"
      titleMeta={<Badge>{docLabel(customer)}</Badge>}
      subtitle={`Cliente desde el ${formatDate(customer.created_at)}`}
      actions={
        <>
          {isAdmin && <Button icon={Trash2} onClick={() => setDeleting(true)}>Eliminar</Button>}
          {dirty && <Button onClick={() => { setDraft(null); setTouched(false); }}>Descartar</Button>}
          <Button variant="primary" disabled={!dirty} loading={save.isPending} onClick={submit}>Guardar</Button>
        </>
      }>
      <Layout
        aside={
          <>
            <Card>
              <CardHeader title="Resumen" />
              <dl className="space-y-1.5">
                <div className="flex justify-between"><dt className="text-ink-secondary">Compras</dt><dd className="tabular-nums">{customer.sales_count}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-secondary">Total comprado</dt><dd className="font-[650] tabular-nums">{formatMoney(customer.sales_total)}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-secondary">Ticket promedio</dt><dd className="tabular-nums">{customer.sales_count ? formatMoney(customer.sales_total / customer.sales_count) : "—"}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-secondary">Última compra</dt><dd>{customer.last_sale_at ? formatDate(customer.last_sale_at) : "—"}</dd></div>
              </dl>
            </Card>
            {(customer.phone || customer.email) && (
              <Card>
                <CardHeader title="Contacto" />
                <div className="space-y-1.5">
                  {customer.phone && <a href={`tel:${customer.phone.replace(/\s/g, "")}`} className="flex items-center gap-2 text-brand hover:underline"><Phone className="size-4" /> {customer.phone}</a>}
                  {customer.email && <a href={`mailto:${customer.email}`} className="flex items-center gap-2 break-all text-brand hover:underline"><Mail className="size-4 shrink-0" /> {customer.email}</a>}
                </div>
              </Card>
            )}
          </>
        }
      >
        <Card>
          <CardHeader title="Datos del cliente" />
          <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <CustomerFields value={form} onChange={setDraft} errors={errors} />
            <button type="submit" hidden />
          </form>
        </Card>
        <Purchases customerId={customer.id} />
      </Layout>

      <Modal open={deleting} onClose={() => setDeleting(false)} title="Eliminar cliente" size="sm"
        primaryAction={{
          label: "Eliminar", destructive: true, loading: remove.isPending,
          onClick: () => remove.mutate(customer.id, {
            onSuccess: () => { toast("Cliente eliminado"); navigate("/clientes", { replace: true }); },
            onError: (e) => toast(e.message, { error: true }),
          }),
        }}>
        <p>Se eliminará a <b>{customer.name}</b>. {customer.sales_count > 0 && `Sus ${customer.sales_count} compras se conservan con su nombre y documento, pero ya no aparecerán en un cliente.`}</p>
      </Modal>
    </Page>
  );
}

/** Historial de compras: todo el personal lo ve (también las ventas de otros cajeros). */
function Purchases({ customerId }: { customerId: string }) {
  const { data, isLoading, error } = useCustomerSales(customerId);
  const me = useStaff();
  const isAdmin = useIsAdmin();
  return (
    <Card padded={false}>
      <div className="px-4 pt-4"><CardHeader title="Compras" description={data && data.length >= 100 ? "Las 100 más recientes" : undefined} /></div>
      {isLoading ? <div className="p-4"><Skeleton className="h-24" /></div>
        : error ? <div className="p-4"><Banner tone="critical">{error.message}</Banner></div>
        : !data?.length ? <p className="border-t border-border px-4 py-6 text-center text-ink-secondary"><Contact className="mx-auto mb-1 size-6 text-ink-tertiary" />Aún no tiene compras registradas.</p>
        : (
          <ul className="divide-y divide-border border-t border-border">
            {data.map((s) => {
              // El detalle de la venta (ticket) solo lo abre el admin o quien la hizo.
              const title = <span className="font-[650]">{ticketNumber(s.number)}</span>;
              return (
                <li key={s.id} className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    {isAdmin || s.user_id === me.user_id ? <Link to={`/ventas/${s.id}`} className="hover:underline">{title}</Link> : title}
                    {s.status === "anulada" && <Badge tone="critical">Anulada</Badge>}
                    <span className="text-[12px] text-ink-secondary">{formatDateTime(s.created_at)} · {paymentLabels[s.payment_method]}{s.cashier ? ` · ${s.cashier}` : ""}</span>
                    <span className={`ml-auto font-[650] tabular-nums ${s.status === "anulada" ? "text-ink-tertiary line-through" : ""}`}>{formatMoney(s.total)}</span>
                  </div>
                  <p className="mt-0.5 text-[12px] text-ink-secondary">
                    {s.items.map((i) => `${i.product_name} ×${i.quantity}${i.unit === "caja" ? (i.quantity === 1 ? " caja" : " cajas") : ""}`).join(" · ") || pluralize(s.item_count, "artículo", "artículos")}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
    </Card>
  );
}
