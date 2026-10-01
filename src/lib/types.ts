export type Role = "admin" | "cajero";

export type Staff = {
  user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: Role;
  is_active: boolean;
  created_at: string;
};

export type Business = {
  name: string;
  ruc: string | null;
  address: string | null;
  phone: string | null;
  ticket_footer: string | null;
  igv_rate: number;
  expiry_warning_days: number;
};

export type Category = { id: string; name: string; color: string; rank: number };
export type Supplier = { id: string; name: string; ruc: string | null; phone: string | null; contact: string | null };

export type DocType = "DNI" | "RUC" | "CE" | "PAS";

/** Fila de la vista customer_list: el cliente y lo que compró (ventas completadas). */
export type Customer = {
  id: string;
  doc_type: DocType;
  doc_number: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  sales_count: number;
  sales_total: number;
  last_sale_at: string | null;
};

/** Compra de un cliente (customer_sales). */
export type CustomerSale = {
  id: string;
  number: number;
  created_at: string;
  status: "completada" | "anulada";
  total: number;
  payment_method: PaymentMethod;
  item_count: number;
  user_id: string | null;
  cashier: string | null;
  items: { product_name: string; unit: SaleUnit; quantity: number; total: number }[];
};

export type DosageForm =
  | "tableta" | "capsula" | "jarabe" | "suspension" | "gotas" | "crema" | "gel" | "unguento" | "inyectable" | "sobre" | "inhalador" | "ovulo" | "solucion" | "spray" | "otro";

export type Product = {
  id: string;
  name: string;
  generic_name: string | null;
  concentration: string | null;
  form: DosageForm;
  presentation: string | null;
  laboratory: string | null;
  category_id: string | null;
  barcode: string | null;
  code: string | null;
  units_per_pack: number;
  sell_by_unit: boolean;
  price_unit: number;
  price_pack: number | null;
  cost_unit: number;
  min_stock: number;
  requires_prescription: boolean;
  is_controlled: boolean;
  igv_exempt: boolean;
  location: string | null;
  is_active: boolean;
  created_at: string;
};

/** Fila de la vista product_stock. */
export type ProductStock = Product & {
  category_name: string | null;
  category_color: string | null;
  stock: number;
  expired_units: number;
  next_expiry: string | null;
  lot_count: number;
  stock_value: number;
  is_low_stock: boolean;
};

export type Lot = {
  id: string;
  product_id: string;
  lot_number: string;
  expiry_date: string | null;
  quantity: number;
  cost_unit: number;
  received_at: string;
};

export type LotStatus = Lot & {
  product_name: string;
  generic_name: string | null;
  concentration: string | null;
  presentation: string | null;
  laboratory: string | null;
  units_per_pack: number;
  days_to_expiry: number | null;
  value: number;
};

export type PaymentMethod = "efectivo" | "yape" | "plin" | "tarjeta" | "transferencia";
export type SaleUnit = "unidad" | "caja";

export type SaleItem = {
  id: string;
  product_id: string | null;
  product_name: string;
  description: string | null;
  unit: SaleUnit;
  quantity: number;
  units: number;
  unit_price: number;
  discount: number;
  total: number;
  cost_total: number;
};

export type Sale = {
  id: string;
  number: number;
  status: "completada" | "anulada";
  cash_session_id: string | null;
  user_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_doc: string | null;
  payment_method: PaymentMethod;
  amount_received: number | null;
  change_given: number | null;
  discount_total: number;
  subtotal: number;
  igv: number;
  total: number;
  cost_total: number;
  item_count: number;
  note: string | null;
  created_at: string;
  voided_at: string | null;
  void_reason: string | null;
  /** Venta hecha en la app Android: cuándo llegó al servidor y qué no cuadró al sincronizarla. */
  synced_at?: string | null;
  sync_notes?: string | null;
};

/** Venta completa devuelta por pos_create_sale / pos_sale (para el ticket). */
export type SaleDetail = Sale & { items: SaleItem[]; cashier: string | null };

export type CashSummary = {
  id: string;
  user_id: string;
  opened_at: string;
  opening_amount: number;
  closed_at: string | null;
  expected_cash: number | null;
  counted_cash: number | null;
  note: string | null;
  closed_by: string | null;
  cashier: string | null;
  closed_by_name: string | null;
  sales_count: number;
  sales_total: number;
  voided_count: number;
  by_method: Partial<Record<PaymentMethod, number>>;
  cash_expected: number;
};
