const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const env = { supabaseUrl: url ?? "", supabaseAnonKey: anonKey ?? "" };

/** Las credenciales siguen siendo las de ejemplo de .env.example. */
export const isSupabaseConfigured = Boolean(url && anonKey) && !url!.includes("tu-proyecto") && !anonKey!.includes("tu-publishable");
