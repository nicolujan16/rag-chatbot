import { createAdminClient, createClient } from "npm:@insforge/sdk";

/**
 * Cuánto le queda al visitante: preguntas del día y espacio usado.
 *
 * Existe como edge function y no como RPC porque el cupo se cuenta por IP, y
 * la IP solo la ve el servidor. El navegador no puede informarla: sería pedirle
 * el dato justo a quien tiene motivos para mentir.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/**
 * Cuántas direcciones agrega la infraestructura de InsForge al final de
 * `x-forwarded-for`. Tiene que coincidir con el de `ask`: si las dos functions
 * leyeran IP distintas, la UI mostraría un cupo y el backend aplicaría otro.
 */
const PROXY_HOPS = 2;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(code: string, message: string, status: number): Response {
  return json({ error: code, message, statusCode: status }, status);
}

/** La IP del visitante, o null si la cadena no tiene la forma esperada. */
function clientIp(req: Request): string | null {
  const chain = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (chain.length < PROXY_HOPS + 1) return null;
  return chain[chain.length - PROXY_HOPS - 1];
}

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

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return fail("method_not_allowed", "Usá POST.", 405);
  }

  const ownerId = await requireUser(req);
  if (!ownerId) {
    return fail("unauthorized", "Necesitás una sesión activa.", 401);
  }

  const admin = createAdminClient({
    baseUrl: Deno.env.get("INSFORGE_BASE_URL"),
    apiKey: Deno.env.get("API_KEY"),
  });

  const { data, error } = await admin.database.rpc("usage_for", {
    p_owner: ownerId,
    p_ip: clientIp(req),
  });

  if (error) {
    return fail("db_error", error.message ?? String(error), 500);
  }

  const row = Array.isArray(data) ? data[0] : data;

  return json({
    questions_used: Number(row?.questions_used ?? 0),
    questions_limit: Number(row?.questions_limit ?? 0),
    bytes_used: Number(row?.bytes_used ?? 0),
    bytes_limit: Number(row?.bytes_limit ?? 0),
    file_bytes_limit: Number(row?.file_bytes_limit ?? 0),
    is_demo: Boolean(row?.is_demo),
  });
}
