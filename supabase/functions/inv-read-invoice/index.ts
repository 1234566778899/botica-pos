// Lee una factura o guía (foto o PDF) con Gemini y devuelve sus líneas en JSON.
// La clave de Gemini está en Vault (public.gemini_api_key(), solo service_role): nunca llega al navegador.
// Solo el personal activo puede usarla. No guarda el archivo.

export const MODEL = "gemini-3.8-flash";
const MAX_BYTES = 15 * 1024 * 1024;
const MIME = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];

const FORMS = ["tableta", "capsula", "jarabe", "suspension", "gotas", "crema", "gel", "unguento", "inyectable", "sobre", "inhalador", "ovulo", "solucion", "spray", "otro"];

const PROMPT = `Eres asistente de una botica en Perú. La imagen o PDF es una factura, boleta o guía de remisión de un proveedor de productos farmacéuticos.
Extrae la cabecera y TODAS las líneas de productos de la tabla, en orden, sin inventar datos. Si un dato no se lee o no existe, déjalo en null.

Cabecera:
- supplier_name: razón social del proveedor que EMITE el documento (no el cliente). supplier_ruc: su RUC (11 dígitos).
- invoice_number: serie y número, p. ej. "F001-679322". issue_date: fecha de emisión en formato AAAA-MM-DD.
- subtotal: suma de los importes de las líneas antes de IGV (el "Sub Total"). igv y total tal como aparecen.

Cada línea:
- code: código del producto del proveedor (columna COD.), como texto con sus ceros.
- quantity: cantidad (columna CANT.). unit: unidad de medida tal cual (CJA, FCO, UND, BLI, TUB, AMP…).
- laboratory: laboratorio o marca tal cual (abreviado si así viene).
- description: la descripción completa tal cual está impresa.
- name: nombre del producto con su concentración, en MAYÚSCULAS, sin la presentación ni el empaque. Ejemplos:
  "SILDENAFILO 100MG X 1 TAB" → "SILDENAFILO 100 MG"; "CLINDAMICINA 300MG X 100 CAPS" → "CLINDAMICINA 300 MG";
  "AMOXI. 500MG+AC. CLAV.125MG X 100 TAB" → "AMOXICILINA + ACIDO CLAVULANICO 500 MG/125 MG";
  "GENTAMICINA 0.3% GTAS X 5ML" → "GENTAMICINA 0.3% GOTAS 5 ML"; "PORTIL NF CR X 20 GR" → "PORTIL NF CREMA 20 G".
  Desarrolla abreviaturas evidentes (AMOXI. → AMOXICILINA, AC. → ACIDO, CLAV. → CLAVULANICO).
- generic_name: principio(s) activo(s) si se reconocen (p. ej. "Amoxicilina + Ácido clavulánico"); null si es una marca que no reconoces.
- units_per_pack: cuántas unidades vendibles trae UNA unidad de la línea. Para una caja "X 100 TAB" es 100, "X 1 TAB" es 1,
  "X 10 AMP" es 10, "X 60SOBRES" es 60, "X 80 TAB (2 TAB X 40 SOBRES)" es 80. Frascos, tubos y unidades sueltas (FCO, TUB, UND) son 1.
- form: forma farmacéutica, una de: ${FORMS.join(", ")}. TAB/TAB REC → tableta, CAPS → capsula, AMP/INY → inyectable,
  GTAS → gotas, SUSP → suspension, JBE → jarabe, CR → crema, SOBRES → sobre.
- expiry: vencimiento (columna F. VTO). Si solo trae mes y año, devuelve "AAAA-MM"; si trae día, "AAAA-MM-DD".
- lot: número de lote tal cual.
- unit_price: precio unitario tal como está impreso (por unidad de la línea, p. ej. por caja). amount: importe de la línea.

Lee con cuidado los números: la foto puede estar inclinada, con sombras o con objetos encima.`;

const nullable = (type: string, extra: Record<string, unknown> = {}) => ({ type, nullable: true, ...extra });

export const SCHEMA = {
  type: "object",
  properties: {
    supplier_name: nullable("string"),
    supplier_ruc: nullable("string"),
    invoice_number: nullable("string"),
    issue_date: nullable("string"),
    subtotal: nullable("number"),
    igv: nullable("number"),
    total: nullable("number"),
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          code: nullable("string"),
          quantity: { type: "number" },
          unit: nullable("string"),
          laboratory: nullable("string"),
          description: { type: "string" },
          name: { type: "string" },
          generic_name: nullable("string"),
          units_per_pack: { type: "integer" },
          form: { type: "string", enum: FORMS },
          expiry: nullable("string"),
          lot: nullable("string"),
          unit_price: nullable("number"),
          amount: nullable("number"),
        },
        required: ["quantity", "description", "name", "units_per_pack", "form"],
      },
    },
  },
  required: ["items"],
};

export async function readInvoice(apiKey: string, mime: string, base64: string) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ inline_data: { mime_type: mime, data: base64 } }, { text: PROMPT }] }],
      generationConfig: { temperature: 0, thinkingConfig: { thinkingLevel: "low" }, responseMimeType: "application/json", responseSchema: SCHEMA },
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message ?? `Gemini respondió ${res.status}`);
  const text = body?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  if (!text) throw new Error("No se pudo leer el documento");
  return JSON.parse(text);
}

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, "content-type": "application/json" } });

// deno-lint-ignore no-explicit-any
const D = (globalThis as any).Deno;
if (D) {
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

      const { mime, data } = await req.json();
      if (!MIME.includes(mime)) return json({ error: "Sube una foto (JPG, PNG, WEBP) o un PDF" }, 400);
      if (typeof data !== "string" || data.length * 0.75 > MAX_BYTES) return json({ error: "El archivo es muy grande (máximo 15 MB)" }, 400);

      const { data: key, error } = await admin.rpc("gemini_api_key");
      if (error || !key) return json({ error: "Falta configurar la clave de Gemini" }, 500);
      return json(await readInvoice(key, mime, data));
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });
}
