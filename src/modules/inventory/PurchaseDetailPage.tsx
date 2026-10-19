import { PackagePlus } from "lucide-react";
import { useParams } from "react-router";
import { isUuid } from "@/lib/supabase";
import { Badge, Banner, Button, Card, CardHeader, Layout, NotFound, Page, Skeleton } from "@/components/ui";
import { extraConcentration, formatDateTime, formatExpiry, formatMoney, formatUnits, pluralize } from "@/lib/format";
import { usePurchase, usePurchaseItems } from "./api";

export function PurchaseDetailPage() {
  const { id } = useParams();
  const valid = isUuid(id);
  const { data: purchase, isLoading, error } = usePurchase(valid ? id : undefined);
  const { data: items, isLoading: loadingItems } = usePurchaseItems(valid ? id : undefined);

  const crumbs = [{ label: "Ingresos", to: "/ingresos" }];
  if (!valid || (!isLoading && !error && !purchase)) return <NotFound title="Ingreso no encontrado" back={crumbs[0]} />;
  if (isLoading) return <Page title="Ingreso" breadcrumbs={crumbs}><Skeleton className="h-80" /></Page>;
  if (error || !purchase) return <Page title="Ingreso" breadcrumbs={crumbs}><Banner tone="critical">{error?.message ?? "Ingreso no encontrado"}</Banner></Page>;

  // Las líneas agregadas después de registrar el ingreso llevan su fecha.
  const added = (createdAt: string) => new Date(createdAt).getTime() - new Date(purchase.created_at).getTime() > 60_000;

  return (
    <Page title={`Ingreso #${purchase.number}`} breadcrumbs={crumbs} largeTitle width="narrow"
      subtitle={`${formatDateTime(purchase.created_at)}${purchase.user_name ? ` · ${purchase.user_name}` : ""}`}
      actions={<Button variant="primary" icon={PackagePlus} to={`/ingresos/${purchase.id}/agregar`}>Agregar productos</Button>}>
      <Layout
        aside={
          <Card>
            <CardHeader title="Documento" />
            <dl className="space-y-1.5">
              <div className="flex justify-between gap-3"><dt className="text-ink-secondary">Proveedor</dt><dd className="text-right">{purchase.supplier_name ?? "—"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-secondary">Factura / guía</dt><dd className="text-right">{purchase.invoice_number ?? "—"}</dd></div>
              {purchase.note && <div className="flex justify-between gap-3"><dt className="text-ink-secondary">Nota</dt><dd className="text-right">{purchase.note}</dd></div>}
            </dl>
          </Card>
        }
      >
        <Card padded={false}>
          <div className="px-4 pt-4"><CardHeader title={`${pluralize(purchase.item_count, "producto", "productos")} · ${purchase.units} u.`} /></div>
          {loadingItems ? <div className="p-4"><Skeleton className="h-40" /></div> : (
            <ul className="divide-y divide-border border-t border-border">
              {(items ?? []).map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="font-[550]">
                      {i.product?.name ?? "Producto"} {i.product && extraConcentration(i.product.name, i.product.concentration) && <span className="font-normal text-ink-secondary">{extraConcentration(i.product.name, i.product.concentration)}</span>}
                      {added(i.created_at) && <Badge tone="info" className="ml-2 align-middle">Agregado {formatDateTime(i.created_at)}</Badge>}
                    </p>
                    <p className="text-[12px] text-ink-secondary">Lote {i.lot_number} · vence {formatExpiry(i.expiry_date)} · {formatMoney(i.cost_unit)} c/u</p>
                  </div>
                  <span className="text-ink-secondary tabular-nums">{formatUnits(i.units, i.product?.units_per_pack ?? 1)}</span>
                  <span className="w-24 text-right font-[550] tabular-nums">{formatMoney(i.total)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-between border-t border-border px-4 py-3 font-[650]">
            <span>Total (costo sin IGV)</span><span className="tabular-nums">{formatMoney(purchase.total)}</span>
          </div>
        </Card>
      </Layout>
    </Page>
  );
}
