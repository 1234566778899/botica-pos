import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CalendarClock, CalendarX, Home, PackageSearch, ScanBarcode } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Button, Card, CardHeader, cn, Page, Skeleton } from "@/components/ui";
import { addDays, expiryLabel, formatLotDate, formatMoney, formatTime, formatUnits, fullName, paymentLabels, todayLima, extraConcentration } from "@/lib/format";
import { supabase, unwrap } from "@/lib/supabase";
import { useStaff } from "@/modules/auth/AuthProvider";
import { ticketNumber } from "@/modules/pos/Ticket";

type Dashboard = {
  from: string; to: string;
  totals: { sales: number; count: number; profit: number; items: number; avg_ticket: number };
  previous: { sales: number; count: number; profit: number };
  voided: number;
  series: { label: string; sales: number; count: number }[];
  by_method: { method: string; total: number; count: number }[];
  top_products: { product_id: string; name: string; units: number; revenue: number }[];
  expiring: { days: number; in_30: number; in_60: number; in_warn: number; value: number;
    lots: { id: string; product_id: string; product_name: string; concentration: string | null; lot_number: string; expiry_date: string; quantity: number; days_to_expiry: number; value: number }[] };
  expired: { count: number; units: number; value: number; lots: { id: string; product_id: string; product_name: string; lot_number: string; expiry_date: string; quantity: number; days_to_expiry: number }[] };
  low_stock: { count: number; products: { id: string; name: string; concentration: string | null; stock: number; min_stock: number; units_per_pack: number }[] };
  inventory: { value: number; products: number; units: number };
  recent_sales: { id: string; number: number; total: number; payment_method: string; status: string; created_at: string; cashier: string | null }[];
};

const ranges = [
  { value: "today", label: "Hoy" },
  { value: "yesterday", label: "Ayer" },
  { value: "7", label: "7 días" },
  { value: "30", label: "30 días" },
] as const;
type Range = (typeof ranges)[number]["value"];

function periodFor(range: Range) {
  const today = todayLima();
  if (range === "today") return { from: today, to: today };
  if (range === "yesterday") return { from: addDays(today, -1), to: addDays(today, -1) };
  return { from: addDays(today, -(Number(range) - 1)), to: today };
}

const SERIES = "#0f9a74"; // validado con dataviz/validate_palette.js (light): ALL PASS
const axisLabel = (label: string) => (label.includes("-") ? new Date(`${label}T12:00:00`).toLocaleDateString("es-PE", { day: "numeric", month: "short" }) : label);

function Delta({ current, previous }: { current: number; previous: number }) {
  if (!previous) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  const up = pct >= 0;
  return (
    <span className={cn("inline-flex items-center text-[12px] font-[550]", up ? "text-success" : "text-critical-strong")}>
      {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}{Math.abs(pct)} %
    </span>
  );
}

function Tile({ label, value, delta, hint }: { label: string; value: string; delta?: React.ReactNode; hint?: string }) {
  return (
    <div className="px-4 py-3">
      <p className="text-[12px] font-medium text-ink-secondary">{label}</p>
      <p className="mt-1 flex items-baseline gap-2 text-[22px] font-[650] tracking-tight tabular-nums">{value} {delta}</p>
      {hint && <p className="text-[11px] text-ink-tertiary">{hint}</p>}
    </div>
  );
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: Dashboard["series"][number] }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-[10px] bg-white px-3 py-2 text-[12px] shadow-popover">
      <p className="text-ink-secondary">{axisLabel(p.label)}</p>
      <p className="mt-0.5 font-[650] text-ink">{formatMoney(p.sales)}</p>
      <p className="text-ink-secondary">{p.count} {p.count === 1 ? "venta" : "ventas"}</p>
    </div>
  );
}

function Alert({ to, icon: Icon, tone, title, value, detail }: { to: string; icon: typeof AlertTriangle; tone: "critical" | "warning" | "info"; title: string; value: string; detail: string }) {
  const tones = { critical: "bg-critical-soft text-critical", warning: "bg-warning-soft text-warning", info: "bg-info-soft text-info" };
  return (
    <Link to={to} className="flex items-center gap-3 rounded-[16px] bg-white p-4 shadow-card transition-shadow hover:shadow-popover">
      <span className={cn("grid size-10 shrink-0 place-items-center rounded-[12px]", tones[tone])}><Icon className="size-5" strokeWidth={1.8} /></span>
      <span className="min-w-0">
        <span className="block text-[12px] font-medium text-ink-secondary">{title}</span>
        <span className="block text-[18px] font-[650] tabular-nums">{value}</span>
        <span className="block truncate text-[12px] text-ink-secondary">{detail}</span>
      </span>
    </Link>
  );
}

export function DashboardPage() {
  const staff = useStaff();
  const [range, setRange] = useState<Range>("today");
  const period = periodFor(range);
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", period.from, period.to],
    queryFn: async () => unwrap(await supabase.rpc("dashboard", { p_from: period.from, p_to: period.to })) as Dashboard,
    refetchInterval: 60_000,
  });
  const methodMax = Math.max(1, ...(data?.by_method.map((m) => Number(m.total)) ?? [1]));

  return (
    <Page icon={Home} title="Inicio" width="full"
      actions={
        <>
          <div className="flex rounded-[10px] bg-surface-pressed/70 p-0.5">
            {ranges.map((r) => (
              <button key={r.value} type="button" onClick={() => setRange(r.value)} className={cn("h-7 rounded-[8px] px-2.5 text-[12px] font-[550]", range === r.value ? "bg-white shadow-button" : "text-ink-secondary")}>{r.label}</button>
            ))}
          </div>
          <Button variant="brand" icon={ScanBarcode} to="/vender">Vender</Button>
        </>
      }>
      <h1 className="mb-4 px-1 text-[20px] font-[650]">Hola, {fullName(staff.first_name) || "equipo"} 👋</h1>

      <Card padded={false} className="grid grid-cols-2 gap-px overflow-hidden bg-border lg:grid-cols-4 [&>*]:bg-white">
        {isLoading || !data ? Array.from({ length: 4 }, (_, i) => <div key={i} className="px-4 py-3"><Skeleton className="h-3 w-20" /><Skeleton className="mt-2 h-6 w-28" /></div>) : (
          <>
            <Tile label="Ventas" value={formatMoney(data.totals.sales)} delta={<Delta current={data.totals.sales} previous={data.previous.sales} />} hint={range === "today" ? "vs. ayer" : "vs. periodo anterior"} />
            <Tile label="N.° de ventas" value={String(data.totals.count)} delta={<Delta current={data.totals.count} previous={data.previous.count} />} hint={data.voided ? `${data.voided} anuladas` : undefined} />
            <Tile label="Ticket promedio" value={formatMoney(data.totals.avg_ticket)} hint={`${data.totals.items} artículos vendidos`} />
            <Tile label="Utilidad bruta" value={formatMoney(data.totals.profit)} delta={<Delta current={data.totals.profit} previous={data.previous.profit} />}
              hint={data.totals.sales ? `Margen ${Math.round((data.totals.profit / data.totals.sales) * 100)} %` : undefined} />
          </>
        )}
      </Card>

      {data && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Alert to="/vencimientos" icon={CalendarClock} tone="warning" title={`Por vencer (${data.expiring.days} días)`} value={`${data.expiring.in_warn} lotes`}
            detail={`${data.expiring.in_30} en 30 días · ${formatMoney(data.expiring.value)}`} />
          <Alert to="/vencimientos?vista=vencidos" icon={CalendarX} tone="critical" title="Vencidos en stock" value={`${data.expired.count} lotes`}
            detail={data.expired.count ? `${data.expired.units} u. · ${formatMoney(data.expired.value)} — dar de baja` : "Todo en orden"} />
          <Alert to="/productos?vista=bajo" icon={AlertTriangle} tone="warning" title="Stock bajo" value={`${data.low_stock.count} productos`} detail="Por debajo del mínimo" />
          <Alert to="/productos" icon={PackageSearch} tone="info" title="Valor del inventario (a costo)"
            value={Number(data.inventory.value) > 0 ? formatMoney(data.inventory.value) : "Sin costos"}
            detail={Number(data.inventory.value) > 0 ? `${data.inventory.products} productos activos` : "Registra el costo en los ingresos para calcularlo"} />
        </div>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader title={range === "today" || range === "yesterday" ? "Ventas por hora" : "Ventas por día"} description={data ? formatMoney(data.totals.sales) : undefined} />
          <div className="h-[260px]" role="img" aria-label="Gráfico de ventas">
            {data && (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="sales-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={SERIES} stopOpacity={0.2} />
                      <stop offset="100%" stopColor={SERIES} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="#ebebeb" />
                  <XAxis dataKey="label" tickFormatter={axisLabel} tick={{ fontSize: 11, fill: "#616161" }} axisLine={false} tickLine={false} minTickGap={20} />
                  <YAxis tickFormatter={(v) => `S/ ${v}`} tick={{ fontSize: 11, fill: "#616161" }} axisLine={false} tickLine={false} width={60} />
                  <Tooltip content={<ChartTooltip />} cursor={{ stroke: "#8a8a8a", strokeDasharray: "3 3" }} />
                  <Area type="monotone" dataKey="sales" stroke={SERIES} strokeWidth={2} fill="url(#sales-fill)" activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Métodos de pago" />
          {data && data.by_method.length === 0 && <p className="text-ink-secondary">Sin ventas en este periodo.</p>}
          <ul className="space-y-3">
            {data?.by_method.map((m) => (
              <li key={m.method}>
                <div className="flex justify-between text-[13px]">
                  <span className="font-[550]">{paymentLabels[m.method] ?? m.method}</span>
                  <span className="tabular-nums">{formatMoney(m.total)} <span className="text-ink-tertiary">· {m.count}</span></span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-surface-pressed">
                  <div className="h-2 rounded-full" style={{ width: `${(Number(m.total) / methodMax) * 100}%`, background: SERIES }} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <Card>
          <CardHeader title="Próximos a vencer" actions={<Button variant="plain" to="/vencimientos">Ver todos</Button>} />
          {data?.expiring.lots.length === 0 && <p className="text-ink-secondary">No hay lotes por vencer.</p>}
          <ul className="divide-y divide-border">
            {data?.expiring.lots.map((l) => (
              <li key={l.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-[550]">{l.product_name} {extraConcentration(l.product_name, l.concentration) && <span className="font-normal text-ink-secondary">{extraConcentration(l.product_name, l.concentration)}</span>}</p>
                  <p className="text-[12px] text-ink-secondary">Lote {l.lot_number} · {l.quantity} u. · vence {formatLotDate(l.expiry_date)}</p>
                </div>
                <Badge tone={l.days_to_expiry <= 30 ? "critical" : "warning"}>{expiryLabel(l.days_to_expiry)}</Badge>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Stock bajo" actions={<Button variant="plain" to="/productos?vista=bajo">Ver todos</Button>} />
          {data?.low_stock.products.length === 0 && <p className="text-ink-secondary">Todos los productos están sobre el mínimo.</p>}
          <ul className="divide-y divide-border">
            {data?.low_stock.products.map((p) => (
              <li key={p.id}>
                <Link to={`/productos/${p.id}`} className="flex items-center gap-3 py-2 hover:text-brand">
                  <span className="min-w-0 flex-1 truncate font-[550]">{p.name} {extraConcentration(p.name, p.concentration) && <span className="font-normal text-ink-secondary">{extraConcentration(p.name, p.concentration)}</span>}</span>
                  <span className={cn("text-[12px] tabular-nums", p.stock === 0 ? "font-[650] text-critical-strong" : "text-warning")}>{p.stock === 0 ? "Agotado" : formatUnits(p.stock, p.units_per_pack)}</span>
                  <span className="w-20 text-right text-[12px] text-ink-tertiary">mín. {p.min_stock}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Más vendidos" />
          {data?.top_products.length === 0 && <p className="text-ink-secondary">Sin ventas en este periodo.</p>}
          <ol className="divide-y divide-border">
            {data?.top_products.map((p, i) => (
              <li key={p.product_id ?? p.name} className="flex items-center gap-3 py-2">
                <span className="w-5 text-center text-[12px] font-[650] text-ink-tertiary">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate font-[550]">{p.name}</span>
                <span className="text-[12px] text-ink-secondary tabular-nums">{p.units} u.</span>
                <span className="w-24 text-right tabular-nums">{formatMoney(p.revenue)}</span>
              </li>
            ))}
          </ol>
        </Card>

        {data && data.expired.count > 0 && (
          <Card>
            <CardHeader title="Vencidos en stock" description="No se pueden vender; dales de baja." actions={<Button variant="plain" to="/vencimientos?vista=vencidos">Revisar</Button>} />
            <ul className="divide-y divide-border">
              {data.expired.lots.map((l) => (
                <li key={l.id} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1 truncate font-[550]">{l.product_name}</span>
                  <span className="text-[12px] text-ink-secondary">Lote {l.lot_number} · {l.quantity} u.</span>
                  <Badge tone="critical">{expiryLabel(l.days_to_expiry)}</Badge>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card className="lg:col-span-2 2xl:col-span-1">
          <CardHeader title="Últimas ventas" actions={<Button variant="plain" to="/ventas">Ver todas</Button>} />
          <ul className="divide-y divide-border">
            {data?.recent_sales.map((s) => (
              <li key={s.id}>
                <Link to={`/ventas/${s.id}`} className="flex items-center gap-3 py-2 hover:text-brand">
                  <span className="w-28 font-[550] tabular-nums">{ticketNumber(s.number)}</span>
                  <span className="w-16 text-[12px] text-ink-secondary">{formatTime(s.created_at)}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-ink-secondary">{paymentLabels[s.payment_method]}{s.cashier ? ` · ${s.cashier}` : ""}</span>
                  {s.status === "anulada" && <Badge tone="critical">Anulada</Badge>}
                  <span className={cn("w-24 text-right tabular-nums", s.status === "anulada" && "text-ink-tertiary line-through")}>{formatMoney(s.total)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </Page>
  );
}
