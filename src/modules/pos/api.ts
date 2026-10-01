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
  // Turno del usuario actual. Pudo abrirlo o cerrarlo desde el teléfono: se recarga cada tanto.
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
    // Si falla porque ya la abrió en el teléfono, recargar muestra ese turno.
    onSettled: () => qc.invalidateQueries({ queryKey: ["cash-current"] }),
  });
}

export type NewSale = {
  /** Id generado en el navegador: reintentar con el mismo id no duplica la venta. */
  id: string;
  items: { product_id: string; unit: SaleUnit; quantity: number }[];
  payment: { method: string; received?: number };
  customer?: { id: string; doc_number: string; name: string };
};

export function useCreateSale() {
  const qc = useQueryClient();
  return useMutation({
    // Sin respuesta en 25 s se da por cortada (el reintento con el mismo id es seguro).
    mutationFn: async (sale: NewSale) => unwrap(await supabase.rpc("pos_create_sale", { p: sale }).abortSignal(AbortSignal.timeout(25_000))) as SaleDetail,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pos-products"] });
      qc.invalidateQueries({ queryKey: ["cash-current"] });
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
    },
    // Puede fallar porque cerró la caja en el teléfono (recargarla muestra la pantalla de apertura)
    // o porque otro cajero vendió lo último (recargar el catálogo muestra el stock real).
    onError: () => {
      qc.invalidateQueries({ queryKey: ["cash-current"] });
      qc.invalidateQueries({ queryKey: ["pos-products"] });
    },
  });
}
