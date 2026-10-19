import { useEffect, useMemo, useReducer } from "react";
import type { ProductStock, SaleUnit } from "@/lib/types";

export type CartLine = { product: ProductStock; unit: SaleUnit; quantity: number };

type Action =
  | { type: "add"; product: ProductStock; unit: SaleUnit; quantity?: number }
  | { type: "set-qty"; index: number; quantity: number }
  | { type: "set-unit"; index: number; unit: SaleUnit }
  | { type: "remove"; index: number }
  | { type: "clear" }
  /** Catálogo recargado: las líneas toman el precio y el stock nuevos. */
  | { type: "refresh"; products: ProductStock[] };

/** El producto viene en blisters (de 10 o 5) y tiene precio por blister. */
export const hasBlister = (p: Pick<ProductStock, "price_blister" | "units_per_blister" | "units_per_pack">) =>
  p.price_blister != null && p.units_per_pack >= p.units_per_blister;

/** Formas de vender el producto: unidad y blister; la caja solo si no tiene blister (la caja son N blisters). */
export function saleUnits(p: ProductStock): SaleUnit[] {
  const units: SaleUnit[] = [];
  if (p.sell_by_unit || p.units_per_pack === 1) units.push("unidad");
  if (hasBlister(p)) units.push("blister");
  else if (p.units_per_pack > 1) units.push("caja");
  return units;
}

export const unitSize = (p: ProductStock, unit: SaleUnit) =>
  unit === "caja" ? p.units_per_pack : unit === "blister" ? p.units_per_blister : 1;

export const unitsPer = (line: Pick<CartLine, "product" | "unit">) => unitSize(line.product, line.unit);

export const unitPrice = (p: ProductStock, unit: SaleUnit) =>
  unit === "caja" ? Number(p.price_pack ?? Number(p.price_unit) * p.units_per_pack)
  : unit === "blister" ? Number(p.price_blister ?? Number(p.price_unit) * p.units_per_blister)
  : Number(p.price_unit);

/** Unidad por defecto: la unidad, o el blister (o la caja) si el producto no se vende fraccionado. */
export const defaultUnit = (p: ProductStock): SaleUnit => saleUnits(p)[0] ?? "unidad";

/** Shift+Enter: la presentación más grande que se vende (blister o caja). */
export const bigUnit = (p: ProductStock): SaleUnit => saleUnits(p).at(-1) ?? "unidad";

function reducer(lines: CartLine[], action: Action): CartLine[] {
  switch (action.type) {
    case "add": {
      const i = lines.findIndex((l) => l.product.id === action.product.id && l.unit === action.unit);
      if (i >= 0) return lines.map((l, j) => (j === i ? { ...l, quantity: l.quantity + (action.quantity ?? 1) } : l));
      return [...lines, { product: action.product, unit: action.unit, quantity: action.quantity ?? 1 }];
    }
    case "set-qty":
      return action.quantity <= 0 ? lines.filter((_, j) => j !== action.index) : lines.map((l, j) => (j === action.index ? { ...l, quantity: action.quantity } : l));
    case "set-unit": {
      // Si ya hay una línea del mismo producto con esa unidad, se juntan.
      const line = lines[action.index];
      const other = lines.findIndex((l, j) => j !== action.index && l.product.id === line.product.id && l.unit === action.unit);
      if (other < 0) return lines.map((l, j) => (j === action.index ? { ...l, unit: action.unit } : l));
      return lines.flatMap((l, j) => (j === action.index ? [] : j === other ? [{ ...l, quantity: l.quantity + line.quantity }] : [l]));
    }
    case "remove":
      return lines.filter((_, j) => j !== action.index);
    case "clear":
      return [];
    case "refresh": {
      const byId = new Map(action.products.map((p) => [p.id, p]));
      let changed = false;
      const next = lines.map((l) => {
        const p = byId.get(l.product.id);
        if (!p || p === l.product) return l;
        changed = true;
        return { ...l, product: p };
      });
      return changed ? next : lines;
    }
  }
}

/** Lee un valor guardado en el navegador (puede fallar en modo privado o con los datos bloqueados). */
export function readStored<T>(key: string | undefined, fallback: T): T {
  if (!key) return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeStored(key: string | undefined, value: unknown) {
  if (!key) return;
  try {
    if (value == null || (Array.isArray(value) && value.length === 0)) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* sin almacenamiento: el carrito solo vive en memoria */ }
}

/**
 * Carrito de la venta. Con `storageKey` se guarda en el navegador: si se recarga la página,
 * se vence la sesión o se cae la conexión, la venta en curso no se pierde.
 */
export function useCart(igvRate = 18, storageKey?: string) {
  const [lines, dispatch] = useReducer(reducer, storageKey, (key) => readStored<CartLine[]>(key, []).filter((l) => l?.product?.id && l.quantity > 0));
  useEffect(() => writeStored(storageKey, lines), [storageKey, lines]);
  const totals = useMemo(() => {
    let total = 0;
    let igv = 0;
    let count = 0;
    for (const l of lines) {
      const t = Math.round(unitPrice(l.product, l.unit) * l.quantity * 100) / 100;
      total += t;
      if (!l.product.igv_exempt) igv += t - t / (1 + igvRate / 100);
      count += l.quantity;
    }
    return { total: Math.round(total * 100) / 100, igv: Math.round(igv * 100) / 100, count };
  }, [lines, igvRate]);

  /** Unidades de stock que ya están en el carrito para un producto. */
  const unitsInCart = (productId: string) => lines.filter((l) => l.product.id === productId).reduce((n, l) => n + l.quantity * unitsPer(l), 0);

  return { lines, dispatch, totals, unitsInCart };
}
