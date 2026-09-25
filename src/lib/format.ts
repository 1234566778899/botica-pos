const money = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "S/ 1,259.90" */
export const formatMoney = (value: number | string | null | undefined) => {
  const n = Math.round(Number(value ?? 0) * 100) / 100;
  return `${n < 0 ? "−" : ""}S/ ${money.format(Math.abs(n))}`;
};

const tz = "America/Lima";
const dateFmt = new Intl.DateTimeFormat("es-PE", { day: "numeric", month: "short", year: "numeric", timeZone: tz });
const shortDateFmt = new Intl.DateTimeFormat("es-PE", { day: "numeric", month: "short", timeZone: tz });
const dateTimeFmt = new Intl.DateTimeFormat("es-PE", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: tz });
const timeFmt = new Intl.DateTimeFormat("es-PE", { hour: "numeric", minute: "2-digit", timeZone: tz });
const monthYearFmt = new Intl.DateTimeFormat("es-PE", { month: "short", year: "numeric", timeZone: "UTC" });

export const formatDate = (iso: string | null | undefined) => (iso ? dateFmt.format(new Date(iso)) : "—");
export const formatShortDate = (iso: string) => shortDateFmt.format(new Date(iso));
export const formatDateTime = (iso: string | null | undefined) => (iso ? dateTimeFmt.format(new Date(iso)) : "—");
export const formatTime = (iso: string) => timeFmt.format(new Date(iso));
/** Vencimiento "mar. 2027" (las fechas de lote son solo fecha, sin hora). */
export const formatExpiry = (date: string | null | undefined) => (date ? monthYearFmt.format(new Date(`${date}T00:00:00Z`)) : "Sin vencimiento");
/** Fecha de un lote "12 mar. 2027". */
export const formatLotDate = (date: string | null | undefined) =>
  date ? new Intl.DateTimeFormat("es-PE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`)) : "—";

/** Hoy en Lima como "2026-09-25" (para filtros de fecha). */
export const todayLima = () => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
export const addDays = (isoDate: string, days: number) => {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Días que faltan para una fecha (negativo si ya pasó). */
export const daysUntil = (date: string | null | undefined) => {
  if (!date) return null;
  return Math.round((new Date(`${date}T00:00:00Z`).getTime() - new Date(`${todayLima()}T00:00:00Z`).getTime()) / 86400000);
};

export const expiryLabel = (days: number | null) =>
  days === null ? "Sin vencimiento" : days < 0 ? `Vencido hace ${-days} ${-days === 1 ? "día" : "días"}` : days === 0 ? "Vence hoy" : `Vence en ${days} ${days === 1 ? "día" : "días"}`;

export const fullName = (first?: string | null, last?: string | null) => [first, last].filter(Boolean).join(" ").trim();
export const pluralize = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Stock en unidades → "3 cajas + 12 u." cuando el producto viene en cajas. */
export function formatUnits(units: number, perPack = 1) {
  if (perPack <= 1) return `${units} u.`;
  const packs = Math.floor(units / perPack);
  const rest = units % perPack;
  if (packs === 0) return `${rest} u.`;
  return `${pluralize(packs, "caja", "cajas")}${rest ? ` + ${rest} u.` : ""}`;
}

/** Minúsculas y sin tildes, para buscar "ibuprofeno" = "Ibuprofeno". */
export const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export const paymentLabels: Record<string, string> = {
  efectivo: "Efectivo", yape: "Yape", plin: "Plin", tarjeta: "Tarjeta", transferencia: "Transferencia",
};

export const formLabels: Record<string, string> = {
  tableta: "Tableta", capsula: "Cápsula", jarabe: "Jarabe", suspension: "Suspensión", gotas: "Gotas", crema: "Crema", gel: "Gel",
  unguento: "Ungüento", inyectable: "Inyectable", sobre: "Sobre", inhalador: "Inhalador", ovulo: "Óvulo", solucion: "Solución", spray: "Spray", otro: "Otro",
};

/** Concentración a mostrar junto al nombre, o null si el nombre ya la incluye ("PARACETAMOL 500 MG"). */
export const extraConcentration = (name: string, concentration: string | null | undefined) => {
  if (!concentration) return null;
  const squash = (s: string) => normalize(s).replace(/\s+/g, "");
  return squash(name).includes(squash(concentration)) ? null : concentration;
};
