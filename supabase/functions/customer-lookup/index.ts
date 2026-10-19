// Nombre del cliente por DNI (8 dígitos) o RUC (11). Primero busca en public.customer
// (clientes registrados: no gasta consultas); si no está, consulta api.decolecta.com y, si
// Decolecta falla o se acabó su cupo, api.migo.pe.
// No guarda nada: el cliente se registra con la RPC customer_save cuando el cajero lo confirma.
// Los tokens están en Vault (public.decolecta_token() y public.migo_token(), solo service_role). Solo personal activo.
// Responde { doc, name, source: "local" | "decolecta" | "migo" } o 404 si no se encontró.

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, "content-type": "application/json" } });

// deno-lint-ignore no-explicit-any
const D = (globalThis as any).Deno;
const { createClient } = await import("npm:@supabase/supabase-js@2");

type Kind = "dni" | "ruc";
// "not_found": el documento no existe (no se pregunta al siguiente proveedor). "error": sin token, sin cupo o caído.
type Lookup = { name: string } | "not_found" | "error";

async function decolecta(token: string, kind: Kind, doc: string): Promise<Lookup> {
  const path = kind === "dni" ? "reniec/dni" : "sunat/ruc";
  const res = await fetch(`https://api.decolecta.com/v1/${path}?numero=${doc}`, {
    headers: { accept: "application/json", authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 404 || res.status === 422) return "not_found";
  const name = String((kind === "dni" ? body?.full_name : body?.razon_social) ?? "").trim();
  return res.ok && name ? { name } : "error";
}

async function migo(token: string, kind: Kind, doc: string): Promise<Lookup> {
  const res = await fetch(`https://api.migo.pe/api/v1/${kind}`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ token, [kind]: doc }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await res.json().catch(() => ({}));
  const name = String((kind === "dni" ? body?.nombre : body?.nombre_o_razon_social) ?? "").trim();
  if (res.ok && body?.success && name) return { name };
  return res.status === 404 || body?.success === false ? "not_found" : "error";
}

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
    const kind: Kind | null = doc.length === 8 ? "dni" : doc.length === 11 ? "ruc" : null;
    if (!kind) return json({ error: "Escribe un DNI de 8 dígitos o un RUC de 11" }, 400);

    const { data: known } = await admin.from("customer").select("name").eq("doc_number", doc).maybeSingle();
    if (known?.name && known.name !== "Cliente") return json({ doc, name: known.name, source: "local" });

    const providers = [
      { source: "decolecta", secret: "decolecta_token", call: decolecta },
      { source: "migo", secret: "migo_token", call: migo },
    ] as const;
    for (const p of providers) {
      const { data: secret } = await admin.rpc(p.secret);
      if (!secret) continue;
      const result = await p.call(secret, kind, doc).catch((): Lookup => "error");
      if (result === "not_found") return json({ error: "No se encontró ese documento" }, 404);
      if (result !== "error") return json({ doc, name: result.name, source: p.source });
    }
    return json({ error: "No se pudo consultar el documento" }, 502);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
