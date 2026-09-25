import { Pill, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Badge, Button, EmptyState, IndexTable, IndexToolbar, Page, type Column } from "@/components/ui";
import { daysUntil, expiryLabel, formatExpiry, formatMoney, formatUnits, normalize, extraConcentration } from "@/lib/format";
import type { ProductStock } from "@/lib/types";
import { useIsAdmin } from "@/modules/auth/AuthProvider";
import { useProducts } from "./api";

type View = "todos" | "bajo" | "vencer" | "agotados" | "receta" | "inactivos";
const views: { value: View; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "bajo", label: "Stock bajo" },
  { value: "vencer", label: "Por vencer" },
  { value: "agotados", label: "Agotados" },
  { value: "receta", label: "Con receta" },
  { value: "inactivos", label: "Inactivos" },
];

const PAGE = 50;

export function ProductsPage() {
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const [params, setParams] = useSearchParams();
  const view = (params.get("vista") as View) || "todos";
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const { data = [], isLoading } = useProducts();

  const rows = useMemo(() => {
    const q = normalize(search.trim());
    return data.filter((p) => {
      if (view === "inactivos" ? p.is_active : !p.is_active) return false;
      if (view === "bajo" && !p.is_low_stock) return false;
      if (view === "agotados" && p.stock > 0) return false;
      if (view === "receta" && !p.requires_prescription) return false;
      if (view === "vencer") { const d = daysUntil(p.next_expiry); if (d === null || d > 90) return false; }
      if (!q) return true;
      return normalize([p.name, p.generic_name, p.laboratory, p.barcode, p.code].filter(Boolean).join(" ")).includes(q);
    });
  }, [data, view, search]);

  const columns: Column<ProductStock>[] = [
    {
      key: "name", header: "Producto",
      render: (p) => (
        <div className="min-w-0">
          <p className="font-[550]">{p.name} {extraConcentration(p.name, p.concentration) && <span className="font-normal text-ink-secondary">{extraConcentration(p.name, p.concentration)}</span>}</p>
          <p className="truncate text-[12px] text-ink-secondary">{[p.generic_name, p.presentation, p.laboratory].filter(Boolean).join(" · ")}</p>
        </div>
      ),
    },
    { key: "cat", header: "Categoría", className: "whitespace-nowrap", render: (p) => p.category_name ? <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: p.category_color ?? "#ccc" }} />{p.category_name}</span> : "—" },
    {
      key: "stock", header: "Stock", className: "whitespace-nowrap",
      render: (p) => p.stock === 0 ? <Badge tone="critical">Agotado</Badge>
        : <span className={p.is_low_stock ? "font-[550] text-warning" : ""}>{formatUnits(p.stock, p.units_per_pack)}</span>,
    },
    {
      key: "exp", header: "Próximo vencimiento", className: "whitespace-nowrap",
      render: (p) => {
        const d = daysUntil(p.next_expiry);
        return d !== null && d <= 90 ? <Badge tone={d <= 30 ? "critical" : "warning"}>{expiryLabel(d)}</Badge> : <span className="text-ink-secondary">{formatExpiry(p.next_expiry)}</span>;
      },
    },
    { key: "flags", header: "", render: (p) => <span className="flex gap-1">{p.requires_prescription && <Badge tone="warning">Receta</Badge>}{p.expired_units > 0 && <Badge tone="critical">{p.expired_units} vencidas</Badge>}</span> },
    { key: "price", header: "Precio", align: "right", className: "whitespace-nowrap", render: (p) => <span className="tabular-nums">{formatMoney(p.price_unit)}{p.units_per_pack > 1 && <span className="block text-[11px] text-ink-tertiary">caja {formatMoney(p.price_pack ?? p.price_unit * p.units_per_pack)}</span>}</span> },
    ...(isAdmin ? [{ key: "value", header: "Valor (costo)", align: "right" as const, className: "whitespace-nowrap", render: (p: ProductStock) => <span className="tabular-nums">{formatMoney(p.stock_value)}</span> }] : []),
  ];

  return (
    <Page icon={Pill} title="Productos" width="full" actions={isAdmin && <Button variant="primary" icon={Plus} to="/productos/nuevo">Nuevo producto</Button>}>
      <IndexTable
        rows={rows.slice((page - 1) * PAGE, page * PAGE)}
        columns={columns}
        getId={(p) => p.id}
        loading={isLoading}
        selectable={false}
        onRowClick={(p) => navigate(`/productos/${p.id}`)}
        resourceName={{ singular: "producto", plural: "productos" }}
        pagination={{ page, pageSize: PAGE, total: rows.length, onChange: setPage }}
        toolbar={
          <IndexToolbar views={views} view={view} onViewChange={(v) => { setParams(v === "todos" ? {} : { vista: v }); setPage(1); }}
            search={search} onSearchChange={(s) => { setSearch(s); setPage(1); }} placeholder="Nombre, principio activo, código" />
        }
        empty={<EmptyState icon={Pill} title="No hay productos aquí" description={view === "bajo" ? "Todos los productos están sobre su stock mínimo." : "Prueba con otra búsqueda o vista."} />}
      />
    </Page>
  );
}
