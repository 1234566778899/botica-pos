import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, unwrap } from "@/lib/supabase";
import type { CashSummary, Category, ProductStock, SaleDetail, SaleUnit } from "@/lib/types";

/** Todo el catálogo activo con stock: se busca en memoria para que sea instantáneo. */
export function usePosProducts() {
  return useQuery({
    queryKey: ["pos-products"],
    queryFn: async () => unwrap(await supabase.from("product_stock").select("*").eq("is_active", true).order("name").limit(5000)) as ProductStock[],
    staleTime: 30_000,
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: async () => unwrap(await supabase.from("category").select("*").order("rank").order("name")) as Category[],
    staleTime: 5 * 60_000,
  });
}

export function useCashCurrent() {
  // La caja es una sola para toda la botica: otro usuario puede abrirla o cerrarla en cualquier momento.
  return useQuery({
    queryKey: ["cash-current"],
    queryFn: async () => unwrap(await supabase.rpc("cash_current")) as CashSummary | null,
    staleTime: 10_000, refetchInterval: 30_000, refetchOnWindowFocus: true,
  });
}

export function useOpenCash() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (amount: number) => unwrap(await supabase.rpc("cash_open", { p_amount: amount })) as CashSummary,
    // Si falla porque otro usuario ya la abrió, recargar muestra esa caja.
    onSettled: () => qc.invalidateQueries({ queryKey: ["cash-current"] }),
  });
}

export type NewSale = {
  items: { product_id: string; unit: SaleUnit; quantity: number }[];
  payment: { method: string; received?: number };
  customer?: { doc_number: string; name: string };
};

export function useCreateSale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sale: NewSale) => unwrap(await supabase.rpc("pos_create_sale", { p: sale })) as SaleDetail,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pos-products"] });
      qc.invalidateQueries({ queryKey: ["cash-current"] });
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["products"] });
    },
    // Puede fallar porque otro usuario cerró la caja: recargarla muestra la pantalla de apertura.
    onError: () => qc.invalidateQueries({ queryKey: ["cash-current"] }),
  });
}
