import { createAdminClient, createClient } from "npm:@insforge/sdk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const EMBEDDING_MODEL = Deno.env.get("OPENROUTER_EMBEDDING_MODEL") ??
  "openai/text-embedding-3-small";
const CHAT_MODEL = Deno.env.get("OPENROUTER_CHAT_MODEL") ?? "openai/gpt-4o-mini";

const REFUSAL = "no tengo esa información en mis documentos";

const SYSTEM_PROMPT =
  `Respondé únicamente con la información del CONTEXTO que te doy abajo.
No uses conocimiento previo ni inventes datos.
Si la respuesta no está en el contexto, respondé exactamente: "${REFUSAL}".
En ese caso no agregues nada más: sin Markdown, sin viñetas y sin comillas.
Respondé en el mismo idioma que la pregunta, de forma concisa.

Formato: usá Markdown cuando ayude a leer la respuesta. Listas para
enumeraciones, **negrita** para los datos clave, tablas para comparar y
bloques de código con su lenguaje. Si la respuesta es una sola idea, dejala
en un párrafo suelto, sin títulos ni viñetas de adorno.
Reproducí las fórmulas matemáticas del contexto tal como estén, con $ para
las de línea y $$ para las de bloque.`;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Error con la forma que espera el SDK (`error` / `message` / `statusCode`),
 * para que `functions.invoke` lo convierta en un InsForgeError con el texto
 * intacto. El SDK descarta cualquier campo extra del cuerpo, así que los
 * números de la cuota van dentro del mensaje.
 */
function fail(code: string, message: string, status: number): Response {
  return json({ error: code, message, statusCode: status }, status);
}

/**
 * Cuántas direcciones agrega la infraestructura de InsForge al final de
 * `x-forwarded-for`. Observado: un pedido desde 190.112.84.146 llega como
 * "190.112.84.146, 10.0.3.7, 3.148.156.80".
 *
 * Importa contar desde la derecha y no desde la izquierda: cualquiera puede
 * mandar su propia cabecera `X-Forwarded-For` y queda anexada adelante, así
 * que la primera entrada es la que el visitante quiera. Las del final las
 * escribe la infraestructura y no se pueden falsificar.
 */
const PROXY_HOPS = 2;

/** La IP del visitante, o null si la cadena no tiene la forma esperada. */
function clientIp(req: Request): string | null {
  const chain = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  // Si la topología cambiara y la cadena se acortara, es preferible quedarse
  // sin IP que tomar una entrada que el visitante controla.
  if (chain.length < PROXY_HOPS + 1) return null;
  return chain[chain.length - PROXY_HOPS - 1];
}

interface AuthedUser {
  id: string;
  // Cliente con el token del usuario: la búsqueda va por acá para que RLS
  // limite los chunks a los suyos. Con el cliente admin vería los de todos.
  client: ReturnType<typeof createClient>;
}

async function requireUser(req: Request): Promise<AuthedUser | null> {
  const header = req.headers.get("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;

  const client = createClient({
    baseUrl: Deno.env.get("INSFORGE_BASE_URL"),
    accessToken: token,
  });

  const { data, error } = await client.auth.getCurrentUser();
  if (error || !data?.user?.id) return null;
  return { id: data.user.id, client };
}

async function embedQuery(input: string, apiKey: string): Promise<number[]> {
  const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input }),
  });

  if (!response.ok) {
    throw new Error(
      `OpenRouter embeddings ${response.status}: ${await response.text()}`,
    );
  }

  const payload = await response.json();
  return payload.data[0].embedding;
}

interface Match {
  id: number;
  content: string;
  source: string;
  chunk_index: number;
  similarity: number;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return fail("method_not_allowed", "Usá POST.", 405);
  }

  const user = await requireUser(req);
  if (!user) {
    return fail("unauthorized", "Necesitás iniciar sesión para preguntar.", 401);
  }

  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) {
    return fail("missing_secret", "Falta el secret OPENROUTER_API_KEY.", 500);
  }

  const body = await req.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  const matchCount = Number.isInteger(body?.match_count) ? body.match_count : 5;

  if (!question) {
    return fail("bad_request", "El campo 'question' es obligatorio.", 400);
  }

  const admin = createAdminClient({
    baseUrl: Deno.env.get("INSFORGE_BASE_URL"),
    apiKey: Deno.env.get("API_KEY"),
  });

  // Descontá el cupo antes de trabajar: cuenta y registra en una sola
  // operación, así dos pedidos a la vez no pasan ambos con el último crédito.
  const { data: consumed, error: quotaError } = await admin.database.rpc(
    "consume_question",
    { p_owner: user.id, p_ip: clientIp(req) },
  );

  if (quotaError) {
    return fail("db_error", quotaError.message ?? String(quotaError), 500);
  }

  const quota = Array.isArray(consumed) ? consumed[0] : consumed;

  if (!quota?.allowed) {
    return fail(
      "daily_limit",
      `Llegaste al límite de ${quota?.max_per_day ?? 5} preguntas por día. Se renueva a la medianoche UTC.`,
      429,
    );
  }

  const usage = {
    questions_used: Number(quota.used),
    questions_limit: Number(quota.max_per_day),
  };

  try {
    const queryEmbedding = await embedQuery(question, apiKey);

    const { data: matches, error: searchError } = await user.client.database.rpc(
      "match_documents",
      {
        query_embedding: queryEmbedding,
        match_count: matchCount,
        match_threshold: 0.0,
      },
    );

    if (searchError) {
      throw new Error(searchError.message ?? String(searchError));
    }

    const chunks = (matches ?? []) as Match[];

    // Sin ningún chunk no hay nada que consultarle al modelo.
    if (chunks.length === 0) {
      return json({ answer: REFUSAL, sources: [], model: CHAT_MODEL, usage });
    }

    const context = chunks
      .map(
        (chunk, i) =>
          `[${i + 1}] (fuente: ${chunk.source}, fragmento ${chunk.chunk_index})\n${chunk.content}`,
      )
      .join("\n\n");

    const completion = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: CHAT_MODEL,
          temperature: 0,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: `CONTEXTO:\n${context}\n\nPREGUNTA: ${question}`,
            },
          ],
        }),
      },
    );

    if (!completion.ok) {
      throw new Error(
        `OpenRouter chat ${completion.status}: ${await completion.text()}`,
      );
    }

    const payload = await completion.json();
    const answer = payload.choices?.[0]?.message?.content?.trim() ?? REFUSAL;

    // Si el modelo no encontró la respuesta, las fuentes recuperadas son ruido.
    const answered = !answer.toLowerCase().includes(REFUSAL);

    return json({
      answer,
      model: payload.model ?? CHAT_MODEL,
      usage,
      sources: answered
        ? chunks.map((chunk) => ({
          id: chunk.id,
          source: chunk.source,
          chunk_index: chunk.chunk_index,
          similarity: Number(chunk.similarity.toFixed(4)),
          excerpt: chunk.content.slice(0, 200),
        }))
        : [],
    });
  } catch (err) {
    // La pregunta nunca se respondió: no se la cobres al usuario.
    if (quota.log_id) {
      await admin.database.rpc("refund_question", { p_log_id: quota.log_id });
    }
    return fail("ask_failed", err instanceof Error ? err.message : String(err), 500);
  }
}
