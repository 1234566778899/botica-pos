import { CalendarClock, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Badge, Button, Card, EmptyState, IndexTable, IndexToolbar, Modal, Page, type Column, useToast } from "@/components/ui";
import { useBusiness } from "@/components/layout/AppFrame";
import { expiryLabel, formatLotDate, formatMoney, formatUnits, normalize, extraConcentration } from "@/lib/format";
import type { LotStatus } from "@/lib/types";
import { useIsAdmin } from "@/modules/auth/AuthProvider";
import { useLots, useWriteOffExpired } from "./api";

type View = "por-vencer" | "30" | "vencidos" | "todos";

export function ExpiryPage() {
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const toast = useToast();
  const { data: business } = useBusiness();
  const warn = business?.expiry_warning_days ?? 90;
  const [params, setParams] = useSearchParams();
  const view = (params.get("vista") as View) || "por-vencer";
  const [search, setSearch] = useState("");
  const [confirming, setConfirming] = useState(false);
  const { data = [], isLoading } = useLots();
  const writeOff = useWriteOffExpired();

  const views: { value: View; label: string }[] = [
    { value: "por-vencer", label: `Por vencer (${warn} días)` },
    { value: "30", label: "Próximos 30 días" },
    { value: "vencidos", label: "Vencidos" },
    { value: "todos", label: "Todos los lotes" },
  ];

  const rows = useMemo(() => {
    const q = normalize(search.trim());
    return data.filter((l) => {
      const d = l.days_to_expiry;
      if (view === "vencidos" && !(d !== null && d < 0)) return false;
      if (view === "30" && !(d !== null && d >= 0 && d <= 30)) return false;
      if (view === "por-vencer" && !(d !== null && d >= 0 && d <= warn)) return false;
      return !q || normalize(`${l.product_name} ${l.generic_name ?? ""} ${l.lot_number}`).includes(q);
    });
  }, [data, view, search, warn]);

  const expired = data.filter((l) => (l.days_to_expiry ?? 1) < 0);
  const value = rows.reduce((n, l) => n + Number(l.value), 0);

  const columns: Column<LotStatus>[] = [
    { key: "p", header: "Producto", render: (l) => <div><p className="font-[550]">{l.product_name} {extraConcentration(l.product_name, l.concentration) && <span className="font-normal text-ink-secondary">{extraConcentration(l.product_name, l.concentration)}</span>}</p><p className="text-[12px] text-ink-secondary">{[l.presentation, l.laboratory].filter(Boolean).join(" · ")}</p></div> },
    { key: "l", header: "Lote", render: (l) => <span className="font-[550]">{l.lot_number}</span> },
    { key: "e", header: "Vencimiento", render: (l) => formatLotDate(l.expiry_date) },
    { key: "d", header: "Estado", render: (l) => l.days_to_expiry === null ? <Badge>Sin vencimiento</Badge> : <Badge tone={l.days_to_expiry < 0 || l.days_to_expiry <= 30 ? "critical" : l.days_to_expiry <= warn ? "warning" : "success"}>{expiryLabel(l.days_to_expiry)}</Badge> },
    { key: "q", header: "Stock", align: "right", className: "whitespace-nowrap", render: (l) => formatUnits(l.quantity, l.units_per_pack) },
    { key: "v", header: "Valor (costo)", align: "right", render: (l) => <span className="tabular-nums">{formatMoney(l.value)}</span> },
  ];

  return (
    <Page icon={CalendarClock} title="Vencimientos"
      actions={isAdmin && expired.length > 0 && <Button variant="critical" onClick={() => setConfirming(true)}>Dar de baja {expired.length} lotes vencidos</Button>}>
      <Card padded={false} className="mb-3 grid grid-cols-2 divide-x divide-border">
        <div className="px-4 py-3"><p className="text-[12px] text-ink-secondary">Lotes en esta vista</p><p className="text-[20px] font-[650] tabular-nums">{rows.length}</p></div>
        <div className="px-4 py-3"><p className="text-[12px] text-ink-secondary">Valor a costo</p><p className="text-[20px] font-[650] tabular-nums">{formatMoney(value)}</p></div>
      </Card>
      <IndexTable rows={rows} columns={columns} getId={(l) => l.id} loading={isLoading} selectable={false}
        onRowClick={(l) => navigate(`/productos/${l.product_id}`)}
        resourceName={{ singular: "lote", plural: "lotes" }}
        toolbar={<IndexToolbar views={views} view={view} onViewChange={(v) => setParams(v === "por-vencer" ? {} : { vista: v })} search={search} onSearchChange={setSearch} placeholder="Producto o lote" />}
        empty={<EmptyState icon={CalendarClock} title={view === "vencidos" ? "No hay productos vencidos" : "No hay lotes por vencer"} description="¡Todo en orden!" />} />
      {isAdmin && <p className="mt-3 flex items-center gap-1.5 px-1 text-[12px] text-ink-secondary"><SlidersHorizontal className="size-3.5" /> Para ajustar un lote puntual (merma, conteo), abre el producto.</p>}

      <Modal open={confirming} onClose={() => setConfirming(false)} title="Dar de baja lotes vencidos" size="sm"
        primaryAction={{
          label: "Dar de baja", destructive: true, loading: writeOff.isPending,
          onClick: () => writeOff.mutate(undefined, { onSuccess: (n) => { toast(`${n} lotes dados de baja`); setConfirming(false); }, onError: (e) => toast(e.message, { error: true }) }),
        }}>
        <p className="text-ink-secondary">Se descontarán {expired.reduce((n, l) => n + l.quantity, 0)} unidades vencidas ({formatMoney(expired.reduce((n, l) => n + Number(l.value), 0))} a costo) y quedará registrado en el kardex.</p>
      </Modal>
    </Page>
  );
}
