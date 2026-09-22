import { createAdminClient } from "npm:@insforge/sdk";

/**
 * Borra las cuentas de demostración vencidas.
 *
 * Cada visitante que toca "Probar demo" deja un usuario real en la base. Sin
 * esta limpieza se acumularían para siempre, con sus documentos y sus vectores
 * ocupando lugar. Borrar el usuario arrastra por CASCADE sus archivos, chunks,
 * conversaciones, mensajes, cupo consumido y la marca en demo_sessions.
 *
 * Qué cuentas están vencidas lo decide `expired_demo_owners()` en SQL, a partir
 * de `limit_demo_lifetime_hours()`. Pensada para correr en un schedule diario,
 * y solo con la API key de administración.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/** El endpoint de borrado acepta lotes; no conviene mandarle miles de una. */
const BATCH_SIZE = 50;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(code: string, message: string, status: number): Response {
  return json({ error: code, message, statusCode: status }, status);
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

  const header = req.headers.get("Authorization");
  const presented = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (presented !== adminKey) {
    return fail("forbidden", "Esta function es solo para administración.", 403);
  }

  const admin = createAdminClient({ baseUrl, apiKey: adminKey });

  // Sin `older_than_hours` usa limit_demo_lifetime_hours(), que es lo que
  // corresponde al schedule. Pasarlo en 0 purga todas las cuentas demo, útil
  // después de probar a mano.
  const body = await req.json().catch(() => null);
  const hours = Number.isInteger(body?.older_than_hours) && body.older_than_hours >= 0
    ? body.older_than_hours
    : null;

  const { data, error } = await admin.database.rpc("expired_demo_owners", {
    p_hours: hours,
  });

  if (error) {
    return fail("db_error", error.message ?? String(error), 500);
  }

  const ids = ((data ?? []) as Array<{ owner_id: string }>)
    .map((row) => row.owner_id)
    .filter(Boolean);

  if (ids.length === 0) {
    return json({ deleted: 0, failed: 0 });
  }

  let deleted = 0;
  let failed = 0;

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);

    const response = await fetch(`${baseUrl}/api/auth/users`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${adminKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userIds: batch }),
    });

    // Un lote que falla no debería frenar a los demás: se informa y sigue.
    if (response.ok) deleted += batch.length;
    else failed += batch.length;
  }

  return json({ deleted, failed });
}
