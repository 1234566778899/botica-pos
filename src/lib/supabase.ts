import { createClient } from "@supabase/supabase-js";
import { env, isSupabaseConfigured } from "./env";

// Cliente único. Usa la publishable key: los permisos los decide RLS (internal.is_staff / is_admin)
// y los workflows pos_* / inv_* / cash_* validan al usuario en el servidor.
export const supabase = createClient(
  isSupabaseConfigured ? env.supabaseUrl : "http://localhost:54321",
  isSupabaseConfigured ? env.supabaseAnonKey : "public-anon-key",
  { auth: { persistSession: true, autoRefreshToken: true, storageKey: "botica-pos-auth" } },
);

/** Lanza el error de Supabase con un mensaje legible (para react-query). */
export function unwrap<T>(res: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (res.error) throw new Error(translateError(res.error.message));
  return res.data as NonNullable<T>;
}

export function translateError(message: string) {
  if (/duplicate key.*barcode/i.test(message)) return "Ya existe otro producto con ese código de barras.";
  if (/duplicate key.*code/i.test(message)) return "Ya existe otro producto con ese código interno.";
  if (/duplicate key.*category_name/i.test(message)) return "Ya existe una categoría con ese nombre.";
  if (/row-level security|permission denied/i.test(message)) return "No tienes permisos para realizar esta acción.";
  if (/Failed to fetch/i.test(message)) return "No se pudo conectar con el servidor. Revisa tu conexión a internet.";
  return message;
}

/** ¿Parece un id de la base? Evita consultar (y mostrar el error de Postgres) con /ventas/abc. */
export const isUuid = (id: string | undefined): id is string => !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
