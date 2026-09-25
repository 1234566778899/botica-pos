import { useMemo, useReducer } from "react";
import type { ProductStock, SaleUnit } from "@/lib/types";

export type CartLine = { product: ProductStock; unit: SaleUnit; quantity: number };

type Action =
  | { type: "add"; product: ProductStock; unit: SaleUnit; quantity?: number }
  | { type: "set-qty"; index: number; quantity: number }
  | { type: "set-unit"; index: number; unit: SaleUnit }
  | { type: "remove"; index: number }
  | { type: "clear" };

export const unitsPer = (line: Pick<CartLine, "product" | "unit">) => (line.unit === "caja" ? line.product.units_per_pack : 1);

export const unitPrice = (p: ProductStock, unit: SaleUnit) =>
  unit === "caja" ? Number(p.price_pack ?? Number(p.price_unit) * p.units_per_pack) : Number(p.price_unit);

/** Unidad por defecto: "caja" si el producto no se vende fraccionado. */
export const defaultUnit = (p: ProductStock): SaleUnit => (!p.sell_by_unit && p.units_per_pack > 1 ? "caja" : "unidad");

function reducer(lines: CartLine[], action: Action): CartLine[] {
  switch (action.type) {
    case "add": {
      const i = lines.findIndex((l) => l.product.id === action.product.id && l.unit === action.unit);
      if (i >= 0) return lines.map((l, j) => (j === i ? { ...l, quantity: l.quantity + (action.quantity ?? 1) } : l));
      return [...lines, { product: action.product, unit: action.unit, quantity: action.quantity ?? 1 }];
    }
    case "set-qty":
      return action.quantity <= 0 ? lines.filter((_, j) => j !== action.index) : lines.map((l, j) => (j === action.index ? { ...l, quantity: action.quantity } : l));
    case "set-unit":
      return lines.map((l, j) => (j === action.index ? { ...l, unit: action.unit } : l));
    case "remove":
      return lines.filter((_, j) => j !== action.index);
    case "clear":
      return [];
  }
}

export function useCart(igvRate = 18) {
  const [lines, dispatch] = useReducer(reducer, []);
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
