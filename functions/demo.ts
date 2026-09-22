import { createAdminClient } from "npm:@insforge/sdk";

/**
 * Crea una cuenta de demostración descartable y le copia el corpus.
 *
 * Con el registro público cerrado, esta function es la única puerta de entrada
 * sin credenciales. Da de alta un usuario real con el cliente admin, le copia
 * los documentos de la plantilla y devuelve las credenciales para que el
 * navegador inicie sesión por el camino normal.
 *
 * Que sea un usuario real y no un modo especial es lo que mantiene el
 * aislamiento: la cuenta demo pasa por las mismas políticas RLS que cualquier
 * otra, así que un visitante no puede ver los documentos de otro.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(code: string, message: string, status: number): Response {
  return json({ error: code, message, statusCode: status }, status);
}

/** Credenciales de un solo uso: nadie las memoriza, la cuenta dura horas. */
function randomCredentials(): { email: string; password: string } {
  return {
    email: `demo-${crypto.randomUUID()}@demo.invalid`,
    password: `${crypto.randomUUID()}${crypto.randomUUID()}`,
  };
}

/**
 * Deshace el alta cuando el resto del aprovisionamiento no llegó a buen puerto.
 * Una cuenta sin corpus no le sirve a nadie, y como no queda registrada en
 * demo_sessions, la limpieza programada nunca la encontraría.
 */
async function discardUser(
  baseUrl: string,
  adminKey: string,
  ownerId: string,
): Promise<void> {
  await fetch(`${baseUrl}/api/auth/users`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${adminKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ userIds: [ownerId] }),
  }).catch(() => {});
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return fail("method_not_allowed", "Usá POST.", 405);
  }

  const baseUrl = Deno.env.get("INSFORGE_BASE_URL");
  const adminKey = Deno.env.get("API_KEY");

  if (!baseUrl || !adminKey) {
    return fail("missing_config", "Falta la configuración del backend.", 500);
  }

  const { email, password } = randomCredentials();

  // El alta va por el endpoint de administración: el registro público está
  // deshabilitado, así que esta es la única forma de crear un usuario.
  const created = await fetch(`${baseUrl}/api/auth/users?client_type=server`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password, name: "Visitante demo" }),
  });

  if (!created.ok) {
    return fail(
      "demo_unavailable",
      `No se pudo crear la cuenta demo (${created.status}).`,
      503,
    );
  }

  const session = await created.json().catch(() => null);

  // Con la verificación por email activa el alta no devuelve ni usuario ni
  // token, solo `requireEmailVerification`. El id se busca entonces por el
  // listado de administración, que es la única fuente que lo tiene siempre.
  let ownerId: string | undefined = session?.user?.id;

  if (!ownerId) {
    const found = await fetch(
      `${baseUrl}/api/auth/users?limit=1&search=${encodeURIComponent(email)}`,
      { headers: { Authorization: `Bearer ${adminKey}` } },
    );

    if (found.ok) {
      const payload = await found.json().catch(() => null);
      const rows = Array.isArray(payload)
        ? payload
        : (payload?.records ?? payload?.users ?? payload?.data ?? []);
      ownerId = rows[0]?.id;
    }
  }

  // Único caso en el que puede quedar una cuenta huérfana: sin id no hay nada
  // que borrar ni que registrar. Es la rama a mirar si aparecen usuarios
  // demo-*@demo.invalid sin documentos.
  if (!ownerId) {
    return fail(
      "demo_unavailable",
      "La cuenta demo se creó pero el backend no devolvió su id.",
      500,
    );
  }

  const admin = createAdminClient({ baseUrl, apiKey: adminKey });

  const { data: provisioned, error: provisionError } = await admin.database.rpc(
    "provision_demo_user",
    { p_owner: ownerId },
  );

  if (provisionError) {
    await discardUser(baseUrl, adminKey, ownerId);

    const message = provisionError.message ?? String(provisionError);
    const busy = message.includes("demo_rate_limited");

    return fail(
      busy ? "demo_busy" : "demo_failed",
      busy
        ? "La demo está recibiendo muchas visitas ahora mismo. Probá de nuevo en un rato."
        : message,
      busy ? 429 : 500,
    );
  }

  const result = Array.isArray(provisioned) ? provisioned[0] : provisioned;

  return json({
    email,
    password,
    files: Number(result?.files ?? 0),
    chunks: Number(result?.chunks ?? 0),
  });
}
