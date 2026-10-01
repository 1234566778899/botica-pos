import { supabase, translateError, unwrap } from "@/lib/supabase";
import type { DosageForm } from "@/lib/types";

/** Lo que devuelve la Edge Function inv-read-invoice (Gemini). */
export type InvoiceLine = {
  code: string | null; quantity: number; unit: string | null; laboratory: string | null;
  description: string; name: string; generic_name: string | null; units_per_pack: number; form: DosageForm;
  expiry: string | null; lot: string | null; unit_price: number | null; amount: number | null;
};

export type InvoiceData = {
  supplier_name: string | null; supplier_ruc: string | null; invoice_number: string | null; issue_date: string | null;
  subtotal: number | null; igv: number | null; total: number | null; items: InvoiceLine[];
};

export type InvoiceMatch = {
  supplier: { id: string; name: string } | null;
  duplicate: { number: number; created_at: string } | null;
  items: { mapped: string | null; candidates: { id: string; score: number }[] }[];
};

/** Desde este puntaje el producto se enlaza solo; entre REVIEW y FOUND se pregunta. */
export const FOUND_SCORE = 0.7;
export const REVIEW_SCORE = 0.3;

const MAX_SIDE = 2400;

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Achica las fotos del celular (suben más rápido); los PDF y HEIC van tal cual. */
async function filePayload(file: File) {
  const mime = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "");
  if (!/^image\/(jpeg|png|webp)$/.test(mime)) return { mime, data: await toBase64(file) };
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  return { mime: "image/jpeg", data: await toBase64(blob ?? file) };
}

export async function readInvoice(file: File): Promise<InvoiceData> {
  const { data, error } = await supabase.functions.invoke("inv-read-invoice", { body: await filePayload(file) });
  if (error) {
    let message = error.message;
    try { message = (await (error as { context?: Response }).context?.json())?.error ?? message; } catch { /* sin cuerpo */ }
    throw new Error(translateError(message));
  }
  const inv = data as InvoiceData;
  if (!inv?.items?.length) throw new Error("No se encontraron productos en el documento.");
  return inv;
}

export async function matchInvoice(inv: InvoiceData) {
  return unwrap(await supabase.rpc("inv_match_invoice", {
    p: {
      supplier_name: inv.supplier_name, supplier_ruc: inv.supplier_ruc, invoice_number: inv.invoice_number,
      items: inv.items.map((i) => ({ code: i.code, name: i.name, description: i.description })),
    },
  })) as InvoiceMatch;
}

/** "2029-07" → "2029-07-31" (último día del mes); "2029-07-15" queda igual. */
export function expiryDate(s: string | null) {
  if (!s) return "";
  const full = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (full) return s;
  const ym = /^(\d{4})-(\d{2})$/.exec(s);
  if (!ym) return "";
  const last = new Date(Date.UTC(Number(ym[1]), Number(ym[2]), 0)).getUTCDate();
  return `${ym[1]}-${ym[2]}-${String(last).padStart(2, "0")}`;
}

export const linePrice = (l: InvoiceLine) => l.unit_price ?? (l.amount != null && l.quantity ? l.amount / l.quantity : 0);

/**
 * ¿Los precios impresos incluyen IGV? Se compara la suma de las líneas con el subtotal y el total.
 * null si no se puede saber (el usuario lo marca a mano).
 */
export function detectIgvIncluded(inv: InvoiceData): boolean | null {
  const sum = inv.items.reduce((n, l) => n + (l.amount ?? l.quantity * linePrice(l)), 0);
  const near = (x: number | null) => x != null && x > 0 && Math.abs(sum - x) <= Math.max(1, x * 0.01);
  if (near(inv.subtotal)) return false;
  if ((inv.subtotal != null && inv.igv != null && near(inv.subtotal + inv.igv)) || near(inv.total)) return true;
  return null;
}
