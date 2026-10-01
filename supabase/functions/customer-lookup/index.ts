// Nombre del cliente por DNI (8 dígitos) o RUC (11). Primero busca en public.customer
// (clientes registrados: no gasta consultas); si no está, consulta api.migo.pe.
// No guarda nada: el cliente se registra con la RPC customer_save cuando el cajero lo confirma.
// El token de Migo está en Vault (public.migo_token(), solo service_role). Solo personal activo.
// Responde { doc, name, source: "local" | "migo" } o 404 si no se encontró.

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, "content-type": "application/json" } });

// deno-lint-ignore no-explicit-any
const D = (globalThis as any).Deno;
const { createClient } = await import("npm:@supabase/supabase-js@2");

D.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  try {
    const admin = createClient(D.env.get("SUPABASE_URL"), D.env.get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: auth } = await admin.auth.getUser(token);
    if (!auth?.user) return json({ error: "Inicia sesión de nuevo" }, 401);
    const { data: staff } = await admin.from("staff").select("user_id").eq("user_id", auth.user.id).eq("is_active", true).maybeSingle();
    if (!staff) return json({ error: "No autorizado" }, 403);

    const { doc: raw } = await req.json();
    const doc = String(raw ?? "").replace(/\D/g, "");
    const kind = doc.length === 8 ? "dni" : doc.length === 11 ? "ruc" : null;
    if (!kind) return json({ error: "Escribe un DNI de 8 dígitos o un RUC de 11" }, 400);

    const { data: known } = await admin.from("customer").select("name").eq("doc_number", doc).maybeSingle();
    if (known?.name && known.name !== "Cliente") return json({ doc, name: known.name, source: "local" });

    const { data: migo, error } = await admin.rpc("migo_token");
    if (error || !migo) return json({ error: "Falta configurar el token de Migo" }, 500);
    const res = await fetch(`https://api.migo.pe/api/v1/${kind}`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ token: migo, [kind]: doc }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json().catch(() => ({}));
    const name = String((kind === "dni" ? body?.nombre : body?.nombre_o_razon_social) ?? "").trim();
    if (!res.ok || !body?.success || !name) {
      const notFound = res.status === 404 || body?.success === false;
      return json({ error: notFound ? "No se encontró ese documento" : "No se pudo consultar el documento" }, notFound ? 404 : 502);
    }

    return json({ doc, name, source: "migo" });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
