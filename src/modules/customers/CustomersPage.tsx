import { Contact, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Button, EmptyState, IndexTable, IndexToolbar, Page, type Column } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";
import type { Customer } from "@/lib/types";
import { docLabel, emptyCustomer, searchCustomers, useCustomers } from "./api";
import { CustomerModal } from "./CustomerForm";

type View = "todos" | "con" | "sin";
const PAGE_SIZE = 50;

export function CustomersPage() {
  const { data = [], isLoading } = useCustomers();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [view, setView] = useState<View>("todos");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  const rows = useMemo(() => {
    const base = view === "todos" ? data : data.filter((c) => (view === "con" ? c.sales_count > 0 : c.sales_count === 0));
    return search.trim() ? searchCustomers(base, search) : base;
  }, [data, search, view]);
  const visible = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const columns: Column<Customer>[] = [
    { key: "n", header: "Cliente", render: (c) => <span><span className="block font-[650]">{c.name}</span><span className="text-[12px] text-ink-secondary">{docLabel(c)}</span></span> },
    { key: "p", header: "Teléfono", render: (c) => c.phone ?? <span className="text-ink-tertiary">—</span> },
    { key: "e", header: "Correo", render: (c) => c.email ?? <span className="text-ink-tertiary">—</span> },
    { key: "c", header: "Compras", align: "right", render: (c) => <span className="tabular-nums">{c.sales_count}</span> },
    { key: "t", header: "Total comprado", align: "right", render: (c) => <span className="tabular-nums">{formatMoney(c.sales_total)}</span> },
    { key: "l", header: "Última compra", align: "right", render: (c) => (c.last_sale_at ? formatDate(c.last_sale_at) : <span className="text-ink-tertiary">—</span>) },
  ];

  return (
    <Page icon={Contact} title="Clientes" actions={<Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Nuevo cliente</Button>}>
      <IndexTable rows={visible} columns={columns} getId={(c) => c.id} loading={isLoading} selectable={false}
        onRowClick={(c) => navigate(`/clientes/${c.id}`)}
        resourceName={{ singular: "cliente", plural: "clientes" }}
        pagination={rows.length > PAGE_SIZE ? { page, pageSize: PAGE_SIZE, total: rows.length, onChange: setPage } : undefined}
        toolbar={
          <IndexToolbar<View>
            views={[{ value: "todos", label: "Todos" }, { value: "con", label: "Con compras" }, { value: "sin", label: "Sin compras" }]}
            view={view} onViewChange={(v) => { setView(v); setPage(1); }}
            search={search} onSearchChange={(s) => { setSearch(s); setPage(1); }} placeholder="Buscar por nombre o DNI / RUC"
          />
        }
        empty={search.trim()
          ? <EmptyState title={`No hay clientes con “${search.trim()}”`} description="Revisa el nombre o el número, o regístralo como cliente nuevo." action={<Button variant="primary" onClick={() => setCreating(true)}>Nuevo cliente</Button>} />
          : <EmptyState icon={Contact} title="Aún no hay clientes" description="Registra a tus clientes con su DNI o RUC para ver qué compran y tener su teléfono o correo a la mano." action={<Button variant="primary" onClick={() => setCreating(true)}>Nuevo cliente</Button>} />}
      />
      {creating && (
        <CustomerModal
          initial={emptyCustomer(/^\d{8}$/.test(search.trim()) ? { doc_number: search.trim() } : /^\d{11}$/.test(search.trim()) ? { doc_type: "RUC", doc_number: search.trim() } : {})}
          onClose={() => setCreating(false)}
          onSaved={(c) => { setCreating(false); navigate(`/clientes/${c.id}`); }}
        />
      )}
    </Page>
  );
}
