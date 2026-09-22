import { createAdminClient } from "npm:@insforge/sdk";

/**
 * Carga un documento en el corpus plantilla de la demo.
 *
 * Es gemela de `ingest` pero escribe en demo_files / demo_documents, que no
 * tienen dueño: el texto se embebe una sola vez acá y después cada cuenta demo
 * recibe una copia de esos vectores sin volver a pagarlos.
 *
 * No la llama el navegador. Solo corre con la API key de administrador, desde
 * la línea de comandos:
 *
 *   npx -y @insforge/cli functions invoke demo-seed \
 *     --data "$(node scripts/demo-seed-payload.mjs demo-corpus/archivo.md)"
 *
 * Repetir la carga de un mismo nombre reemplaza la versión anterior.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const EMBEDDING_MODEL = Deno.env.get("OPENROUTER_EMBEDDING_MODEL") ??
  "openai/text-embedding-3-small";

/** ~4 caracteres por token es una aproximación suficiente para cortar chunks. */
const CHARS_PER_TOKEN = 4;
const TARGET_TOKENS = 500;
const OVERLAP_TOKENS = 60;
const TARGET_CHARS = TARGET_TOKENS * CHARS_PER_TOKEN;
const OVERLAP_CHARS = OVERLAP_TOKENS * CHARS_PER_TOKEN;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(code: string, message: string, status: number): Response {
  return json({ error: code, message, statusCode: status }, status);
}

/**
 * Misma partición que `ingest`: fragmentos de ~500 tokens que respetan límites
 * de oración y arrastran las últimas ~60 como solapamiento. Está duplicada
 * porque cada edge function se despliega como un archivo suelto, sin módulos
 * compartidos; si cambia una, hay que cambiar la otra o el corpus de la demo
 * dejaría de partirse igual que el de un usuario real.
 */
function chunkText(text: string): string[] {
  const sentences = text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);

  const chunks: string[] = [];
  let current: string[] = [];
  let length = 0;
  let carried = 0;

  const flush = () => {
    if (current.length === 0) return;
    chunks.push(current.join(" "));

    const carry: string[] = [];
    let carryLength = 0;
    for (let i = current.length - 1; i > 0 && carryLength < OVERLAP_CHARS; i--) {
      carry.unshift(current[i]);
      carryLength += current[i].length + 1;
    }

    current = carry;
    length = carryLength;
    carried = carry.length;
  };

  for (const sentence of sentences) {
    if (sentence.length > TARGET_CHARS) {
      flush();
      current = [];
      length = 0;
      carried = 0;
      for (let i = 0; i < sentence.length; i += TARGET_CHARS) {
        chunks.push(sentence.slice(i, i + TARGET_CHARS).trim());
      }
      continue;
    }

    if (length + sentence.length + 1 > TARGET_CHARS) flush();

    current.push(sentence);
    length += sentence.length + 1;
  }

  if (current.length > carried) chunks.push(current.join(" "));
  return chunks;
}

async function embed(inputs: string[], apiKey: string): Promise<number[][]> {
  const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: inputs }),
  });

  if (!response.ok) {
    throw new Error(
      `OpenRouter embeddings ${response.status}: ${await response.text()}`,
    );
  }

  const payload = await response.json();
  return payload.data
    .sort((a: { index: number }, b: { index: number }) => a.index - b.index)
    .map((item: { embedding: number[] }) => item.embedding);
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return fail("method_not_allowed", "Usá POST.", 405);
  }

  // Sembrar el corpus gasta embeddings y cambia lo que ve todo visitante:
  // exige la API key de administrador, no el token de un usuario.
  const adminKey = Deno.env.get("API_KEY");
  const header = req.headers.get("Authorization");
  const presented = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (!adminKey || presented !== adminKey) {
    return fail("forbidden", "Esta function es solo para administración.", 403);
  }

  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) {
    return fail("missing_secret", "Falta el secret OPENROUTER_API_KEY.", 500);
  }

  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const source = typeof body?.source === "string" && body.source.trim()
    ? body.source.trim().slice(0, 200)
    : "";

  if (!text || !source) {
    return fail("bad_request", "Se necesitan 'source' y 'text'.", 400);
  }

  const admin = createAdminClient({
    baseUrl: Deno.env.get("INSFORGE_BASE_URL"),
    apiKey: adminKey,
  });

  try {
    const chunks = chunkText(text);
    if (chunks.length === 0) {
      throw new Error("El texto no produjo ningún chunk.");
    }

    const embeddings = await embed(chunks, apiKey);
    const bytes = new TextEncoder().encode(text).length;

    // Reemplazar en vez de acumular: el FK con CASCADE se lleva los chunks
    // viejos, así que volver a sembrar deja el corpus en un estado limpio.
    const { error: deleteError } = await admin.database
      .from("demo_files")
      .delete()
      .eq("name", source);

    if (deleteError) {
      throw new Error(deleteError.message ?? String(deleteError));
    }

    const { data: inserted, error: fileError } = await admin.database
      .from("demo_files")
      .insert([{ name: source, bytes, chunks: chunks.length }])
      .select();

    if (fileError) {
      throw new Error(fileError.message ?? String(fileError));
    }

    const fileId = (Array.isArray(inserted) ? inserted[0] : inserted)?.id;
    if (!fileId) {
      throw new Error("La fila de demo_files no devolvió id.");
    }

    const { error: insertError } = await admin.database
      .from("demo_documents")
      .insert(chunks.map((content, index) => ({
        file_id: fileId,
        content,
        source,
        chunk_index: index,
        embedding: embeddings[index],
        embedding_model: EMBEDDING_MODEL,
      })));

    if (insertError) {
      throw new Error(insertError.message ?? String(insertError));
    }

    return json({
      source,
      model: EMBEDDING_MODEL,
      bytes,
      chunks_inserted: chunks.length,
    });
  } catch (err) {
    return fail(
      "seed_failed",
      err instanceof Error ? err.message : String(err),
      500,
    );
  }
}
