import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, unwrap } from "@/lib/supabase";
import type { Sale, SaleDetail } from "@/lib/types";

export type SaleRow = Sale & { cashier: string | null };
export type SaleFilters = { from: string; to: string; status: "todas" | "completada" | "anulada"; method: string; search: string; page: number };

export const PAGE_SIZE = 50;
/** Perú no tiene horario de verano: el día en Lima va de 00:00 a 23:59 en UTC−5. */
const limaStart = (d: string) => `${d}T00:00:00-05:00`;
const limaEnd = (d: string) => `${d}T23:59:59.999-05:00`;

export function useSales(f: SaleFilters) {
  return useQuery({
    queryKey: ["sales", f],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = supabase.from("sale_list").select("*", { count: "exact" }).gte("created_at", limaStart(f.from)).lte("created_at", limaEnd(f.to))
        .order("created_at", { ascending: false }).range((f.page - 1) * PAGE_SIZE, f.page * PAGE_SIZE - 1);
      if (f.status !== "todas") q = q.eq("status", f.status);
      if (f.method) q = q.eq("payment_method", f.method);
      const n = Number(f.search.replace(/\D/g, ""));
      const term = f.search.replace(/[,()*%]/g, " ").trim();
      if (term) q = n && /^\D*\d+$/.test(term) ? q.or(`number.eq.${n},customer_doc.ilike.%${term}%`) : q.or(`customer_name.ilike.%${term}%,customer_doc.ilike.%${term}%`);
      const res = await q;
      if (res.error) throw new Error(res.error.message);
      return { rows: res.data as SaleRow[], count: res.count ?? 0 };
    },
  });
}

export function useSaleTotals(f: Pick<SaleFilters, "from" | "to">) {
  return useQuery({
    queryKey: ["sales", "totals", f.from, f.to],
    queryFn: async () => {
      const rows = unwrap(await supabase.from("sale").select("total, status, payment_method").gte("created_at", limaStart(f.from)).lte("created_at", limaEnd(f.to)).limit(20000));
      const done = rows.filter((r) => r.status === "completada");
      return { total: done.reduce((n, r) => n + Number(r.total), 0), count: done.length, voided: rows.length - done.length };
    },
  });
}

export function useSale(id: string | undefined) {
  return useQuery({ queryKey: ["sales", "detail", id], enabled: Boolean(id), queryFn: async () => unwrap(await supabase.rpc("pos_sale", { p_sale: id })) as SaleDetail });
}

export function useVoidSale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => unwrap(await supabase.rpc("pos_void_sale", { p_sale: id, p_reason: reason })) as SaleDetail,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["pos-products"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["cash-current"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
