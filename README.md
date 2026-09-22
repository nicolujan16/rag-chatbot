# RAG Chatbot

Chat que responde **solo** con lo que dicen tus documentos, y que admite no saber.

Subís archivos de texto, se parten en fragmentos y se indexan como vectores. Cuando
preguntás, se recuperan los fragmentos más parecidos y se le pasan a un LLM con una
instrucción estricta: responder únicamente con ese contexto y, si la respuesta no está
ahí, decir `no tengo esa información en mis documentos` en vez de inventar.

Cada usuario ve solo sus documentos y sus chats, con aislamiento aplicado en la base de
datos y no en el código de la aplicación.

---

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, Tailwind v4 |
| Backend | InsForge — Postgres, auth, edge functions en Deno |
| Vectores | pgvector con índice HNSW y distancia coseno |
| Modelos | OpenRouter — `text-embedding-3-small` (1536 dims) y `gpt-4o-mini` |

## Arquitectura

```
Navegador (Next.js)
  │
  ├── @insforge/sdk ──────────────► Postgres vía PostgREST
  │     auth, chats, archivos        RLS filtra por auth.uid()
  │
  └── functions.invoke ───────────► Edge functions (Deno)
        ingest / ask                  │
                                      ├──► OpenRouter  (embeddings + chat)
                                      └──► Postgres    (pgvector + cuotas)
```

**`ingest`** valida el token, reserva la cuota de almacenamiento, parte el texto en
fragmentos de ~500 tokens con solapamiento, genera los embeddings en un solo lote y los
inserta.

**`ask`** valida el token, descuenta una pregunta del cupo diario, embebe la consulta,
recupera los 5 fragmentos más cercanos con `match_documents`, y se los pasa al LLM junto
con la instrucción de no salirse de ese contexto. Devuelve la respuesta y sus fuentes con
el score de similitud de cada una.

## Modelo de datos

| Tabla | Para qué | Quién escribe |
|---|---|---|
| `documents` | Fragmentos con su `embedding vector(1536)` | Solo las functions (cliente admin) |
| `ingested_files` | Un archivo por fila, con sus bytes: es el contador de la cuota | Functions; el usuario puede borrar |
| `conversations` / `messages` | Historial del chat | El navegador con el token del usuario |
| `question_log` | Append-only, cuenta el cupo diario | Solo las functions |

Borrar una fila de `ingested_files` arrastra sus fragmentos por la clave foránea y libera
la cuota, así que el usuario puede administrar su espacio sin intervención.

---

## Decisiones de diseño

Las que tienen un porqué que no se ve leyendo el código.

**`ask` busca con el cliente del usuario, no con el admin.**
`match_documents` es `SECURITY INVOKER`, así que corre con el rol de quien la llama. Si
la búsqueda usara el cliente admin, RLS quedaría fuera de juego y la búsqueda vectorial
recorrería los documentos de todos los usuarios. La política de `documents` es lo único
que los separa.

**La cuota se reserva antes de generar un solo embedding.**
`reserve_file` inserta la fila del archivo y devuelve si entra en el espacio disponible.
Si algo falla después, esa fila se borra y el espacio vuelve. Al revés —verificar,
trabajar, registrar— dos subidas simultáneas pasarían ambas con el último hueco libre.

**Contar y registrar una pregunta es una sola operación atómica.**
`consume_question` toma un lock por usuario, cuenta y registra en la misma transacción.
Separado en dos pasos, dos pedidos concurrentes con el último crédito pasarían los dos.

**Si falla el proveedor de modelos, se devuelve la pregunta.**
Con un cupo de 5 diarias, perder una por un error ajeno al usuario es mala experiencia.
`refund_question` borra el registro cuando la respuesta nunca llegó a generarse.

**`question_log` no tiene políticas RLS, a propósito.**
Sin políticas, `anon` y `authenticated` no pueden tocarla: solo la escriben las functions
con el cliente admin. Si el usuario pudiera borrar sus filas, reiniciaría su propio
límite diario.

**El solapamiento arrastra oraciones completas, no caracteres.**
La primera versión cortaba por cantidad de caracteres y dejaba fragmentos que empezaban a
mitad de palabra (`"o anual de capacitación..."`). Además de verse mal, ensucia el
embedding del fragmento.

**El Markdown se renderiza sin `rehype-raw`.**
El texto viene de un LLM que repite el contenido de archivos subidos por el usuario.
Habilitar HTML crudo sería ejecutar HTML de terceros en la sesión.

---

## Límites por usuario

| Límite | Valor | Dónde vive |
|---|---|---|
| Preguntas por día | 5 | `limit_questions_per_day()` |
| Almacenamiento total | 2 MiB de texto | `limit_storage_bytes()` |
| Tamaño por archivo | 1 MiB | `limit_file_bytes()` |

Los tres viven **solo en SQL**. La UI los lee con `my_usage()` y las functions los aplican
a través de `reserve_file` y `consume_question`, así que no pueden desincronizarse: para
cambiarlos se toca una función y nada más.

El de 2 MiB no es arbitrario. Cada fragmento de ~500 tokens ocupa unos 6 KB solo en el
vector (1536 floats × 4 bytes), así que 2 MiB de texto son ~1050 fragmentos ≈ 6,3 MB de
vectores por usuario. En el plan gratuito de InsForge eso deja lugar para varias decenas
de usuarios. En texto plano, 2 MiB son unas 600 páginas.

El día se corta a **medianoche UTC**, no en el huso local.

---

## Puesta en marcha

Requiere Node 20+, una cuenta de InsForge y una clave de OpenRouter.

```bash
npm install

# Backend: vincular el proyecto y aplicar el esquema
npx -y @insforge/cli login
npx -y @insforge/cli link --project-id <tu-project-id>
npx -y @insforge/cli db migrations up --all

# La clave de OpenRouter va como secret del backend, nunca en el repo.
# Los secrets se inyectan al desplegar: si la rotás, hay que volver a
# desplegar ambas functions para que la tomen.
npx -y @insforge/cli secrets add OPENROUTER_API_KEY sk-or-v1-...
npx -y @insforge/cli functions deploy ingest --file ./functions/ingest.ts
npx -y @insforge/cli functions deploy ask --file ./functions/ask.ts
```

`.env.local` con los valores de tu proyecto:

```bash
NEXT_PUBLIC_INSFORGE_URL=https://<tu-proyecto>.insforge.app
NEXT_PUBLIC_INSFORGE_ANON_KEY=anon_...
```

Ambas son públicas por diseño: la clave anónima solo habilita lo que permitan las
políticas RLS. La clave de administrador nunca sale del backend.

```bash
npm run dev
```

### Los endpoints por HTTP

Las dos functions exigen un `Bearer` válido; sin él devuelven 401.

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
- **Sin tope global de gasto.** El alta es abierta y cada usuario nuevo son 5 preguntas
  diarias contra la clave de OpenRouter del dueño del proyecto.
- **Recuperación sin umbral.** `match_documents` devuelve siempre los 5 más cercanos, aun
  si son irrelevantes; quien filtra es el prompt del modelo.
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
