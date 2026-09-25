import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "./Button";
import { Card } from "./Card";
import { cn } from "./cn";
import { Skeleton } from "./Feedback";

export type Column<T> = {
  key: string;
  header: React.ReactNode;
  render: (row: T) => React.ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
};

type Props<T> = {
  rows: T[];
  columns: Column<T>[];
  getId: (row: T) => string;
  loading?: boolean;
  selectable?: boolean;
  /** Acciones cuando hay filas seleccionadas. */
  bulkActions?: (ids: string[], clear: () => void) => React.ReactNode;
  onRowClick?: (row: T) => void;
  toolbar?: React.ReactNode;
  empty?: React.ReactNode;
  resourceName?: { singular: string; plural: string };
  pagination?: { page: number; pageSize: number; total: number; onChange: (page: number) => void };
};

/** Tabla de recursos estilo "index table": selección, acciones en lote, filas clicables. */
export function IndexTable<T>({ rows, columns, getId, loading, selectable = true, bulkActions, onRowClick, toolbar, empty, resourceName = { singular: "elemento", plural: "elementos" }, pagination }: Props<T>) {
  const [selected, setSelected] = useState<string[]>([]);
  const ids = useMemo(() => rows.map(getId), [rows, getId]);
  useEffect(() => setSelected((s) => s.filter((id) => ids.includes(id))), [ids]);

  const allSelected = ids.length > 0 && selected.length === ids.length;
  const toggleAll = () => setSelected(allSelected ? [] : ids);
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const clear = () => setSelected([]);

  return (
    <Card padded={false} className="overflow-hidden">
      {toolbar && <div className="border-b border-border">{toolbar}</div>}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="h-9 border-b border-border bg-surface-muted text-[12px] text-ink-secondary">
              {selectable && (
                <th className="w-10 pl-3.5">
                  <input type="checkbox" aria-label="Seleccionar todo" checked={allSelected} ref={(el) => { if (el) el.indeterminate = selected.length > 0 && !allSelected; }} onChange={toggleAll} className="size-[14px] accent-[#303030]" />
                </th>
              )}
              {selected.length > 0 ? (
                <th colSpan={columns.length} className="py-1 pr-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink">{selected.length} {selected.length === 1 ? "seleccionado" : "seleccionados"}</span>
                    {bulkActions?.(selected, clear)}
                  </div>
                </th>
              ) : (
                columns.map((c) => (
                  <th key={c.key} className={cn("px-3 font-medium whitespace-nowrap first:pl-3.5", c.align === "right" && "text-right", c.align === "center" && "text-center")}>
                    {c.header}
                  </th>
                ))
              )}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 6 }, (_, i) => (
                  <tr key={i} className="h-12 border-b border-border last:border-0">
                    {selectable && <td className="pl-3.5"><Skeleton className="size-3.5" /></td>}
                    {columns.map((c) => (
                      <td key={c.key} className="px-3"><Skeleton className="h-3 w-3/4" /></td>
                    ))}
                  </tr>
                ))
              : rows.map((row) => {
                  const id = getId(row);
                  const isSel = selected.includes(id);
                  return (
                    <tr
                      key={id}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      className={cn("h-12 border-b border-border last:border-0", onRowClick && "cursor-pointer", isSel ? "bg-surface-hover" : "hover:bg-surface-muted")}
                    >
                      {selectable && (
                        <td className="pl-3.5" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" aria-label="Seleccionar fila" checked={isSel} onChange={() => toggle(id)} className="size-[14px] accent-[#303030]" />
                        </td>
                      )}
                      {columns.map((c) => (
                        <td key={c.key} className={cn("px-3 py-1.5 first:pl-3.5", c.align === "right" && "text-right", c.align === "center" && "text-center", c.className)}>
                          {c.render(row)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>
      {!loading && rows.length === 0 && empty}
      {pagination && pagination.total > pagination.pageSize && (
        <div className="flex items-center justify-between border-t border-border bg-surface-muted px-3.5 py-2 text-[12px] text-ink-secondary">
          <span>
            {(pagination.page - 1) * pagination.pageSize + 1}–{Math.min(pagination.page * pagination.pageSize, pagination.total)} de {pagination.total} {resourceName.plural}
          </span>
          <div className="flex gap-1">
            <Button size="icon" icon={ChevronLeft} disabled={pagination.page <= 1} onClick={() => pagination.onChange(pagination.page - 1)}>
              Anterior
            </Button>
            <Button size="icon" icon={ChevronRight} disabled={pagination.page * pagination.pageSize >= pagination.total} onClick={() => pagination.onChange(pagination.page + 1)}>
              Siguiente
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
