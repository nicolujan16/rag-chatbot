import { createAdminClient, createClient } from "npm:@insforge/sdk";

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

/**
 * Error con la forma que espera el SDK (`error` / `message` / `statusCode`),
 * para que `functions.invoke` lo convierta en un InsForgeError con el texto
 * intacto. El mensaje ya viene armado con los números de la cuota, porque el
 * SDK descarta cualquier campo extra del cuerpo.
 */
function fail(code: string, message: string, status: number): Response {
  return json({ error: code, message, statusCode: status }, status);
}

function mb(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Valida el token del usuario contra el backend y devuelve su id. */
async function requireUser(req: Request): Promise<string | null> {
  const header = req.headers.get("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;

  const client = createClient({
    baseUrl: Deno.env.get("INSFORGE_BASE_URL"),
    accessToken: token,
  });

  const { data, error } = await client.auth.getCurrentUser();
  if (error || !data?.user?.id) return null;
  return data.user.id;
}

/**
 * Parte el texto en fragmentos de ~500 tokens respetando límites de oración.
 * Cada fragmento arrastra las últimas ~60 tokens del anterior como solapamiento,
 * para que una idea partida al medio siga siendo recuperable desde ambos lados.
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

  // Cierra el chunk actual y arrastra oraciones completas como solapamiento,
  // para que ningún fragmento empiece a mitad de palabra.
  const flush = () => {
    if (current.length === 0) return;
    chunks.push(current.join(" "));

    const carry: string[] = [];
    let carryLength = 0;
    // i > 0 evita arrastrar el chunk entero, que dejaría el bucle sin avanzar.
    for (let i = current.length - 1; i > 0 && carryLength < OVERLAP_CHARS; i--) {
      carry.unshift(current[i]);
      carryLength += current[i].length + 1;
    }

    current = carry;
    length = carryLength;
    carried = carry.length;
  };

  for (const sentence of sentences) {
    // Una oración más larga que el chunk entero se corta a lo bruto.
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

  // Solo si quedó contenido nuevo más allá del solapamiento arrastrado.
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
  // El orden de data[] corresponde al de inputs, pero index lo deja explícito.
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

  const ownerId = await requireUser(req);
  if (!ownerId) {
    return fail("unauthorized", "Necesitás iniciar sesión para subir documentos.", 401);
  }

  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) {
    return fail("missing_secret", "Falta el secret OPENROUTER_API_KEY.", 500);
  }

  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const source = typeof body?.source === "string" && body.source.trim()
    ? body.source.trim().slice(0, 200)
    : "sin-fuente";

  if (!text) {
    return fail("bad_request", "El campo 'text' es obligatorio.", 400);
  }

  const admin = createAdminClient({
    baseUrl: Deno.env.get("INSFORGE_BASE_URL"),
    apiKey: Deno.env.get("API_KEY"),
  });

  // Reserva la cuota antes de gastar un solo token en embeddings.
  const bytes = new TextEncoder().encode(text).length;
  const { data: reserved, error: reserveError } = await admin.database.rpc(
    "reserve_file",
    { p_owner: ownerId, p_name: source, p_bytes: bytes },
  );

  if (reserveError) {
    return fail("db_error", reserveError.message ?? String(reserveError), 500);
  }

  const reservation = Array.isArray(reserved) ? reserved[0] : reserved;

  if (!reservation?.allowed) {
    const limit = Number(reservation?.max_bytes ?? 0);
    const used = Number(reservation?.used ?? 0);
    const free = Math.max(0, limit - used);
    return fail(
      reservation?.reason ?? "quota_exceeded",
      reservation?.reason === "file_too_large"
        ? `"${source}" ocupa ${mb(bytes)} y supera el máximo por archivo.`
        : `Sin espacio: "${source}" ocupa ${mb(bytes)} y te quedan ${mb(free)} de ${mb(limit)}.`,
      413,
    );
  }

  const fileId = reservation.file_id;

  try {
    const chunks = chunkText(text);
    if (chunks.length === 0) {
      throw new Error("El texto no produjo ningún chunk.");
    }

    const embeddings = await embed(chunks, apiKey);

    const rows = chunks.map((content, index) => ({
      owner_id: ownerId,
      file_id: fileId,
      content,
      source,
      chunk_index: index,
      embedding: embeddings[index],
      embedding_model: EMBEDDING_MODEL,
    }));

    const { error: insertError } = await admin.database
      .from("documents")
      .insert(rows);

    if (insertError) {
      throw new Error(insertError.message ?? String(insertError));
    }

    await admin.database
      .from("ingested_files")
      .update({ chunks: chunks.length })
      .eq("id", fileId);

    return json({
      source,
      model: EMBEDDING_MODEL,
      bytes,
      chunks_inserted: chunks.length,
      bytes_used: Number(reservation.used),
      bytes_limit: Number(reservation.max_bytes),
    });
  } catch (err) {
    // Devolvé el espacio reservado: la fila del archivo arrastra sus chunks.
    await admin.database.from("ingested_files").delete().eq("id", fileId);
    return fail("ingest_failed", err instanceof Error ? err.message : String(err), 500);
  }
}
