import { normalize } from "@/lib/format";
import type { ProductStock } from "@/lib/types";

const haystack = (p: ProductStock) =>
  normalize([p.name, p.generic_name, p.concentration, p.laboratory, p.presentation, p.category_name, p.barcode, p.code].filter(Boolean).join(" "));

/**
 * Búsqueda en memoria. Cada palabra debe aparecer (nombre, principio activo, laboratorio…).
 * Orden: código exacto > empieza con el nombre > nombre contiene > principio activo > resto; con stock primero.
 */
export function searchProducts(products: ProductStock[], query: string, categoryId: string | null) {
  const q = normalize(query.trim());
  const pool = categoryId ? products.filter((p) => p.category_id === categoryId) : products;
  if (!q) return [...pool].sort((a, b) => Number(b.stock > 0) - Number(a.stock > 0) || a.name.localeCompare(b.name, "es"));

  const terms = q.split(/\s+/);
  const scored: { p: ProductStock; score: number }[] = [];
  for (const p of pool) {
    const code = q === (p.barcode ?? "") || q === normalize(p.code ?? "");
    const text = haystack(p);
    if (!code && !terms.every((t) => text.includes(t))) continue;
    const name = normalize(p.name);
    const generic = normalize(p.generic_name ?? "");
    const score =
      (code ? 1000 : 0) +
      (name.startsWith(q) ? 120 : name.includes(q) ? 60 : 0) +
      (generic.startsWith(q) ? 50 : generic.includes(q) ? 30 : 0) +
      (p.stock > 0 ? 15 : 0);
    scored.push({ p, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name, "es")).map((s) => s.p);
}

/** ¿El texto parece un código de barras / código interno escaneado? */
export const exactCodeMatch = (products: ProductStock[], query: string) => {
  const q = query.trim();
  if (!q) return undefined;
  return products.find((p) => p.barcode === q || (p.code && p.code.toLowerCase() === q.toLowerCase()));
};

/** Otros productos con el mismo principio activo y concentración (genéricos / marcas equivalentes). */
export function equivalents(products: ProductStock[], product: ProductStock) {
  if (!product.generic_name) return [];
  const g = normalize(product.generic_name);
  const c = normalize(product.concentration ?? "");
  return products.filter((p) => p.id !== product.id && normalize(p.generic_name ?? "") === g && normalize(p.concentration ?? "") === c);
}
