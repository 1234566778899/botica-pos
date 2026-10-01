import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { normalize } from "@/lib/format";
import { supabase, unwrap } from "@/lib/supabase";
import type { Customer, CustomerSale, DocType } from "@/lib/types";

export const docTypeLabels: Record<DocType, string> = { DNI: "DNI", RUC: "RUC", CE: "Carné de extranjería", PAS: "Pasaporte" };

/** "DNI 45566385" / "RUC 20123456789" */
export const docLabel = (c: Pick<Customer, "doc_type" | "doc_number">) => `${c.doc_type === "PAS" ? "Pasaporte" : c.doc_type} ${c.doc_number}`;

/** Todos los clientes con sus compras: se buscan en memoria (en la venta y en la lista). */
export function useCustomers() {
  return useQuery({
    queryKey: ["customers"],
    queryFn: async () => unwrap(await supabase.from("customer_list").select("*").order("name").limit(10000)) as Customer[],
    staleTime: 30_000,
  });
}

export function useCustomer(id: string | undefined) {
  return useQuery({
    queryKey: ["customers", "detail", id],
    enabled: Boolean(id),
    queryFn: async () => unwrap(await supabase.from("customer_list").select("*").eq("id", id!).maybeSingle()) as Customer | null,
  });
}

export function useCustomerSales(id: string | undefined) {
  return useQuery({
    queryKey: ["customers", "sales", id],
    enabled: Boolean(id),
    queryFn: async () => unwrap(await supabase.rpc("customer_sales", { p_customer: id })) as CustomerSale[],
  });
}

export type CustomerInput = {
  id?: string;
  doc_type: DocType;
  doc_number: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  note: string;
};

export const emptyCustomer = (patch: Partial<CustomerInput> = {}): CustomerInput => ({
  doc_type: "DNI", doc_number: "", name: "", phone: "", email: "", address: "", note: "", ...patch,
});

export const toInput = (c: Customer): CustomerInput => ({
  id: c.id, doc_type: c.doc_type, doc_number: c.doc_number, name: c.name === "Cliente" ? "" : c.name,
  phone: c.phone ?? "", email: c.email ?? "", address: c.address ?? "", note: c.note ?? "",
});

/** Las mismas reglas que customer_save (el servidor vuelve a validarlas). */
export function validateCustomer(c: CustomerInput): Partial<Record<keyof CustomerInput, string>> {
  const e: Partial<Record<keyof CustomerInput, string>> = {};
  const doc = c.doc_number.replace(/[\s-]/g, "").toUpperCase();
  if (c.doc_type === "DNI" && !/^\d{8}$/.test(doc)) e.doc_number = "El DNI tiene 8 dígitos";
  if (c.doc_type === "RUC" && !/^\d{11}$/.test(doc)) e.doc_number = "El RUC tiene 11 dígitos";
  if ((c.doc_type === "CE" || c.doc_type === "PAS") && !/^[A-Z0-9]{5,15}$/.test(doc)) e.doc_number = "Entre 5 y 15 letras o números";
  if (!c.name.trim()) e.name = "Escribe el nombre";
  if (c.phone.trim() && !/^\+?[0-9 ]{6,20}$/.test(c.phone.trim())) e.phone = "Solo números (mínimo 6)";
  if (c.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email.trim())) e.email = "Correo inválido";
  return e;
}

export function useSaveCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (c: CustomerInput) => unwrap(await supabase.rpc("customer_save", { p: c })) as Customer,
    onSuccess: (saved) => {
      qc.setQueryData<Customer[]>(["customers"], (list) => list && [...list.filter((x) => x.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)));
      qc.setQueryData(["customers", "detail", saved.id], saved);
      qc.invalidateQueries({ queryKey: ["customers"] });
    },
  });
}

/** Solo administradores (RLS). Las ventas del cliente se conservan con el nombre y documento que tenían. */
export function useDeleteCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const rows = unwrap(await supabase.from("customer").delete().eq("id", id).select("id"));
      // RLS no da error si no puede borrar: simplemente no borra nada.
      if (rows.length === 0) throw new Error("No se pudo eliminar el cliente (solo un administrador puede hacerlo)");
      return id;
    },
    // Sin recargar la ficha: volvería vacía y la página mostraría "Cliente no encontrado" antes de salir de ella.
    onSuccess: (id) => {
      qc.setQueryData<Customer[]>(["customers"], (list) => list?.filter((c) => c.id !== id));
      qc.invalidateQueries({ queryKey: ["customers"], exact: true });
    },
  });
}

/**
 * Busca por documento (los dígitos escritos) o por nombre (todas las palabras, sin tildes).
 * Primero el documento exacto; luego los que compraron más recientemente.
 */
export function searchCustomers(list: Customer[], query: string, limit = Infinity) {
  const q = normalize(query.trim());
  if (!q) return list.slice(0, limit);
  const doc = q.replace(/[\s-]/g, "");
  const isDoc = /^[a-z]{0,2}\d{3,}$/.test(doc);
  const words = q.split(/\s+/);
  const hits = list.filter((c) => (isDoc ? c.doc_number.toLowerCase().includes(doc) : words.every((w) => normalize(`${c.name} ${c.doc_number}`).includes(w))));
  const score = (c: Customer) => (c.doc_number.toLowerCase() === doc ? 2 : c.doc_number.toLowerCase().startsWith(doc) ? 1 : 0);
  return hits.sort((a, b) => score(b) - score(a) || (b.last_sale_at ?? "").localeCompare(a.last_sale_at ?? "") || a.name.localeCompare(b.name)).slice(0, limit);
}

/**
 * Nombre por DNI (8) o RUC (11): primero los clientes registrados, si no api.migo.pe
 * (Edge Function customer-lookup). Devuelve null si no se encontró.
 */
export async function lookupDocName(doc: string): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke("customer-lookup", { body: { doc } });
  if (error) {
    const status = (error as { context?: Response }).context?.status;
    if (status === 404) return null;
    let message = error.message;
    try { message = (await (error as { context?: Response }).context?.json())?.error ?? message; } catch { /* sin cuerpo */ }
    throw new Error(message);
  }
  return (data as { name?: string })?.name ?? null;
}
