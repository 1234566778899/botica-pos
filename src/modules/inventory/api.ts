import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, unwrap } from "@/lib/supabase";
import type { Lot, LotStatus, Product, ProductStock, Supplier } from "@/lib/types";

/** Invalida todo lo que depende del stock. */
function useInvalidateStock() {
  const qc = useQueryClient();
  return () => ["products", "pos-products", "lots", "movements", "purchases", "dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

export function useProducts() {
  return useQuery({
    queryKey: ["products", "list"],
    queryFn: async () => unwrap(await supabase.from("product_stock").select("*").order("name").limit(5000)) as ProductStock[],
  });
}

export function useProduct(id: string | undefined) {
  return useQuery({
    queryKey: ["products", "detail", id],
    enabled: Boolean(id),
    queryFn: async () => unwrap(await supabase.from("product_stock").select("*").eq("id", id!).single()) as ProductStock,
  });
}

export function useProductLots(id: string | undefined) {
  return useQuery({
    queryKey: ["lots", "product", id],
    enabled: Boolean(id),
    queryFn: async () => unwrap(await supabase.from("lot").select("*").eq("product_id", id!).order("expiry_date", { ascending: true, nullsFirst: false })) as Lot[],
  });
}

export type ProductDraft = Omit<Product, "id" | "created_at" | "cost_unit"> & { id?: string; cost_unit?: number };

export function useSaveProduct() {
  const invalidate = useInvalidateStock();
  return useMutation({
    mutationFn: async (p: ProductDraft) => {
      const { id, ...row } = p;
      const clean = { ...row, barcode: row.barcode?.trim() || null, code: row.code?.trim() || null, price_pack: row.price_pack || null };
      const res = id ? await supabase.from("product").update(clean).eq("id", id).select("id").single() : await supabase.from("product").insert(clean).select("id").single();
      return unwrap(res).id as string;
    },
    onSuccess: invalidate,
  });
}

export function useAdjustLot() {
  const invalidate = useInvalidateStock();
  return useMutation({
    mutationFn: async (a: { lot: string; quantity: number; type: "ajuste" | "vencido" | "merma"; note: string }) =>
      unwrap(await supabase.rpc("inv_adjust_lot", { p_lot: a.lot, p_new_quantity: a.quantity, p_type: a.type, p_note: a.note })),
    onSuccess: invalidate,
  });
}

export function useWriteOffExpired() {
  const invalidate = useInvalidateStock();
  return useMutation({
    mutationFn: async () => unwrap(await supabase.rpc("inv_write_off_expired")) as number,
    onSuccess: invalidate,
  });
}

export function useLots() {
  return useQuery({
    queryKey: ["lots", "status"],
    queryFn: async () => unwrap(await supabase.from("lot_status").select("*").order("expiry_date", { ascending: true, nullsFirst: false }).limit(5000)) as LotStatus[],
  });
}

export function useSuppliers() {
  return useQuery({ queryKey: ["suppliers"], queryFn: async () => unwrap(await supabase.from("supplier").select("*").order("name")) as Supplier[], staleTime: 5 * 60_000 });
}

export type PurchaseRow = {
  id: string; number: number; supplier_name: string | null; invoice_number: string | null; total: number; note: string | null;
  user_name: string | null; created_at: string; item_count: number; units: number;
};

export function usePurchases() {
  return useQuery({
    queryKey: ["purchases"],
    queryFn: async () => unwrap(await supabase.from("purchase_list").select("*").order("created_at", { ascending: false }).limit(200)) as PurchaseRow[],
  });
}

export type ReceiveItem = { product_id: string; lot_number: string; expiry_date: string; units: number; cost_unit: number };

export function useReceive() {
  const invalidate = useInvalidateStock();
  return useMutation({
    mutationFn: async (p: { supplier_id: string | null; invoice_number: string; note: string; items: ReceiveItem[] }) =>
      unwrap(await supabase.rpc("inv_receive_purchase", { p })) as { id: string; number: number },
    onSuccess: invalidate,
  });
}

export type NewProductInput = {
  name: string; generic_name: string | null; form: string; presentation: string | null; laboratory: string | null;
  units_per_pack: number; price_unit: number; price_pack: number | null;
};

export type InvoiceReceiveItem = Omit<ReceiveItem, "product_id"> & { product_id?: string; new_product?: NewProductInput; supplier_code?: string | null };

/** Ingreso con proveedor y productos nuevos (desde la factura leída). Lo crea todo en una transacción. */
export function useReceiveInvoice() {
  const invalidate = useInvalidateStock();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: {
      supplier_id: string | null; supplier: { name: string; ruc: string | null } | null; invoice_number: string; note: string;
      allow_duplicate: boolean; items: InvoiceReceiveItem[];
    }) => unwrap(await supabase.rpc("inv_receive_invoice", { p })) as { id: string; number: number },
    onSuccess: () => { invalidate(); qc.invalidateQueries({ queryKey: ["suppliers"] }); },
  });
}

export type MovementRow = {
  id: string; product_id: string; product_name: string; concentration: string | null; units_per_pack: number; lot_number: string | null; expiry_date: string | null;
  type: "compra" | "venta" | "anulacion" | "ajuste" | "vencido" | "merma"; units: number; balance: number; note: string | null; user_name: string | null; created_at: string;
};

export function useMovements(f: { productId?: string; type?: string; page: number }) {
  return useQuery({
    queryKey: ["movements", f],
    queryFn: async () => {
      let q = supabase.from("movement_list").select("*", { count: "exact" }).order("created_at", { ascending: false }).range((f.page - 1) * 50, f.page * 50 - 1);
      if (f.productId) q = q.eq("product_id", f.productId);
      if (f.type) q = q.eq("type", f.type);
      const res = await q;
      if (res.error) throw new Error(res.error.message);
      return { rows: res.data as MovementRow[], count: res.count ?? 0 };
    },
  });
}
