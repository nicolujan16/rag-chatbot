# RAG Chatbot

*[English version](README.md)*

Chat que responde **solo** con lo que dicen tus documentos, y que admite no saber.

**En vivo: [ragchatbot.insforge.site](https://ragchatbot.insforge.site)** — no hace falta
registrarse, tocá **Probar demo**.

Subís archivos de texto, se parten en fragmentos y se indexan como vectores. Cuando
preguntás, se recuperan los fragmentos más parecidos y se le pasan a un LLM con una
instrucción estricta: responder únicamente con ese contexto y, si la respuesta no está
ahí, decir `no tengo esa información en mis documentos` en vez de inventar.

Cada visitante ve solo sus documentos y sus chats.

No hay contraseñas ni formulario de alta: el registro está cerrado en el backend y el
acceso con cuenta está desactivado por ahora. Todo el que llega recibe una cuenta
descartable propia, y el cupo diario se cuenta por dirección IP y no por cuenta — ver
[Modo demo](#modo-demo).

---

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, Tailwind v4 |
| Backend | InsForge — Postgres, auth, edge functions en Deno |
| Vectores | pgvector con índice HNSW y distancia coseno |
| Modelos | OpenRouter — `text-embedding-3-small` (1536 dims) y `gpt-4o-mini` |
| Hosting | Deployments de InsForge (Vercel por debajo) |

## Arquitectura

```
Navegador (Next.js)
  │
  ├── @insforge/sdk ──────────────► Postgres vía PostgREST
  │     auth, chats, archivos        RLS filtra por auth.uid()
  │
  └── functions.invoke ───────────► Edge functions (Deno)
        demo / ingest / ask / usage   │
                                      ├──► OpenRouter  (embeddings + chat)
                                      └──► Postgres    (pgvector + cuotas)

Solo administración (CLI / schedule)
  └── demo-seed, demo-cleanup ────► Postgres + API admin de auth
```

**`ingest`** parte un documento en fragmentos de ~500 tokens, los embebe y los guarda.

**`ask`** embebe la pregunta, recupera los 5 fragmentos más cercanos con `match_documents`
y devuelve la respuesta del LLM junto con sus fuentes.

**`demo`** crea una cuenta descartable con el corpus de demostración ya cargado.

**`usage`** devuelve las preguntas que quedan en el día y el espacio usado.

**`demo-seed`** carga un documento en el corpus plantilla. Solo con la API key de
administración.

**`demo-cleanup`** borra las cuentas demo vencidas. Solo con la API key de administración,
lo dispara un schedule diario.

## Modelo de datos

| Tabla | Para qué | Quién escribe |
|---|---|---|
| `documents` | Fragmentos con su `embedding vector(1536)` | Solo las functions (cliente admin) |
| `ingested_files` | Un archivo por fila, con sus bytes: es el contador de la cuota | Functions; el usuario puede borrar |
| `conversations` / `messages` | Historial del chat | El navegador con el token del usuario |
| `question_log` | Append-only, cuenta el cupo diario por IP | Solo las functions |
| `demo_files` / `demo_documents` | El corpus plantilla de la demo, sin dueño | Solo `demo-seed` |
| `demo_sessions` | Marca qué cuentas son demo y cuándo nacieron | Solo `demo` |

---

## Límites

| Límite | Valor | Se cuenta por | Dónde vive |
|---|---|---|---|
| Preguntas por día | 5 | dirección IP | `limit_questions_per_ip_per_day()` |
| Almacenamiento total | 2 MiB de texto | cuenta | `limit_storage_bytes()` |
| Tamaño por archivo | 1 MiB | archivo | `limit_file_bytes()` |

Y tres que acotan el sistema como conjunto:

| Límite | Valor | Dónde vive |
|---|---|---|
| Preguntas diarias de todos juntos | 300 | `limit_demo_questions_per_day_global()` |
| Cuentas demo nuevas por hora | 20 | `limit_demo_sessions_per_hour()` |
| Vida de una cuenta demo | 24 h | `limit_demo_lifetime_hours()` |

El día se corta a **medianoche UTC**, no en el huso local.

---

## Modo demo

Tocar **Probar demo** crea una cuenta descartable con el corpus de ejemplo de
[`demo-corpus/`](demo-corpus/) ya cargado — seis documentos sobre qué es un RAG, cómo está
hecho este proyecto y quién lo hizo, en español e inglés. La cuenta se borra a las 24
horas. El cupo diario se cuenta por IP, así que una cuenta nueva no lo reinicia.

Cargar o recargar un documento en el corpus plantilla (es el único paso que gasta
embeddings; volver a sembrar el mismo nombre reemplaza la versión anterior):

```bash
npx -y @insforge/cli functions invoke demo-seed \
  --data "$(node scripts/demo-seed-payload.mjs demo-corpus/que-es-un-rag.md)"
```

Borrar las cuentas demo vencidas. Corre todos los días a las 04:00 UTC; una ventana de
cero purga todas las cuentas demo ahora mismo:

```bash
npx -y @insforge/cli functions invoke demo-cleanup --data '{"older_than_hours":0}'
```

---

## Puesta en marcha

Requiere Node 20+, una cuenta de InsForge y una clave de OpenRouter.

```bash
npm install

# Backend: vincular el proyecto y aplicar el esquema
npx -y @insforge/cli login
npx -y @insforge/cli link --project-id <tu-project-id>
npx -y @insforge/cli db migrations up --all

# La configuración de auth vive en insforge.toml y se aplica como código
npx -y @insforge/cli config apply

# La clave de OpenRouter va como secret del backend, nunca en el repo.
# Los secrets se inyectan al desplegar: si la rotás, hay que volver a
# desplegar las functions para que la tomen.
npx -y @insforge/cli secrets add OPENROUTER_API_KEY sk-or-v1-...
npx -y @insforge/cli functions deploy ingest --file ./functions/ingest.ts
npx -y @insforge/cli functions deploy ask --file ./functions/ask.ts
npx -y @insforge/cli functions deploy usage --file ./functions/usage.ts
npx -y @insforge/cli functions deploy demo --file ./functions/demo.ts
npx -y @insforge/cli functions deploy demo-seed --file ./functions/demo-seed.ts
npx -y @insforge/cli functions deploy demo-cleanup --file ./functions/demo-cleanup.ts
```

Después se siembra el corpus una vez (ver [Modo demo](#modo-demo)) y se agenda la
limpieza:

```bash
npx -y @insforge/cli schedules create \
  --name "Demo cleanup" \
  --cron "0 4 * * *" \
  --url "https://<tu-proyecto>.insforge.app/functions/demo-cleanup" \
  --method POST \
  --headers '{"Authorization":"Bearer ${{secrets.API_KEY}}","Content-Type":"application/json"}' \
  --body '{}'
```

### Configuración de auth

[`insforge.toml`](insforge.toml) guarda la configuración de auth. `disable_signup = true` y
`require_email_verification = false` van juntos: si algún día volvés a abrir el registro,
reactivá la verificación en el mismo cambio.

### Variables de entorno

`.env.local` para desarrollo local:

```bash
NEXT_PUBLIC_INSFORGE_URL=https://<tu-proyecto>.insforge.app
NEXT_PUBLIC_INSFORGE_ANON_KEY=anon_...
```

Ambas son públicas por diseño: la clave anónima solo habilita lo que permitan las
políticas RLS. La clave de administrador nunca sale del backend.

El build desplegado no lee `.env.local` —la subida excluye `.env*`— así que los mismos dos
valores se guardan como variables de entorno del deployment:

```bash
npx -y @insforge/cli deployments env set NEXT_PUBLIC_INSFORGE_URL https://<tu-proyecto>.insforge.app
npx -y @insforge/cli deployments env set NEXT_PUBLIC_INSFORGE_ANON_KEY anon_...
npx -y @insforge/cli deployments deploy .
```

```bash
npm run dev
```

### Los endpoints por HTTP

`ingest`, `ask` y `usage` exigen un `Bearer` válido; sin él devuelven 401. `demo` toma la
clave anónima, como cualquier function pública.

```bash
curl -X POST "https://<tu-proyecto>.insforge.app/functions/ingest" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"source": "manual.md", "text": "..."}'

curl -X POST "https://<tu-proyecto>.insforge.app/functions/ask" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"question": "¿Qué dice el manual sobre el mantenimiento?"}'
```

---

## Estado y limitaciones conocidas

Lo que todavía no hace, dicho de frente:

- **Solo texto plano** (`.txt`, `.md`, `.csv`, `.json`). Sin PDF.
- **Sin memoria conversacional.** Cada pregunta viaja sola al modelo: los mensajes
  anteriores se guardan y se muestran, pero no entran al prompt. Un "¿y cuánto sale el
  Pro?" después de una tabla no funciona.
- **Sin streaming.** La respuesta aparece completa al terminar.
- **Recuperación sin umbral.** `match_documents` devuelve siempre los 5 más cercanos, aun
  si son irrelevantes; quien filtra es el prompt del modelo.
- **El límite por IP es un lomo de burro, no un muro.** Frena el uso repetido casual; no
  frena a nadie con una VPN o un celular con datos móviles. El tope global diario es lo que
  realmente acota la factura, y nada vigila el saldo de OpenRouter en sí.
- **Las IP compartidas comparten el cupo.** Detrás del NAT de una oficina o un campus, las
  primeras cinco preguntas del día se gastan las de todos.
- **El corpus de la demo se duplica por visitante.** 16 fragmentos ≈ 100 KB de vectores por
  cuenta demo. Alcanza a esta escala; un corpus compartido de solo lectura escalaría mejor.
- **`demo-seed` repite el código de troceado de `ingest`.** Las edge functions se despliegan
  como archivos sueltos, sin módulo compartido, así que las dos copias hay que mantenerlas
  sincronizadas a mano.
- **Sin tests automatizados.**

### Una medición pendiente

Durante el desarrollo apareció algo que vale la pena dejar anotado: con fragmentos de 500
tokens sobre documentos cortos, los scores de similitud caen a ~0.35 y en una prueba el
fragmento correcto quedó **segundo** (0.3505 contra 0.3698 de uno irrelevante). La
respuesta salió bien igual, porque con pocos fragmentos y `match_count: 5` entra todo al
contexto y el modelo filtra.

Los embeddings no son el problema: verificado directamente contra OpenRouter, dan 0.86
entre paráfrasis y 0.15 entre temas no relacionados. Lo que pasa es que un fragmento de
500 tokens puede cubrir dos temas distintos y eso diluye la señal. Con documentos más
cortos y enfocados los scores suben a 0.55-0.67 y el orden se corrige.

Cerrar esto pide un set de evaluación con métricas de recuperación (recall@k, MRR) y un
barrido de tamaños de fragmento. Es el próximo paso natural del proyecto.
