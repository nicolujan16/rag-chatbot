# RAG Chatbot

*[English version](README.md)*

Chat que responde **solo** con lo que dicen tus documentos, y que admite no saber.

**En vivo: [39237v7a.insforge.site](https://39237v7a.insforge.site)** — no hace falta
registrarse, tocá **Probar demo**.

Subís archivos de texto, se parten en fragmentos y se indexan como vectores. Cuando
preguntás, se recuperan los fragmentos más parecidos y se le pasan a un LLM con una
instrucción estricta: responder únicamente con ese contexto y, si la respuesta no está
ahí, decir `no tengo esa información en mis documentos` en vez de inventar.

Cada visitante ve solo sus documentos y sus chats, con aislamiento aplicado en la base de
datos y no en el código de la aplicación.

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

**`ingest`** valida el token, reserva la cuota de almacenamiento, parte el texto en
fragmentos de ~500 tokens con solapamiento, genera los embeddings en un solo lote y los
inserta.

**`ask`** valida el token, descuenta una pregunta del cupo diario, embebe la consulta,
recupera los 5 fragmentos más cercanos con `match_documents`, y se los pasa al LLM junto
con la instrucción de no salirse de ese contexto. Devuelve la respuesta y sus fuentes con
el score de similitud de cada una.

**`demo`** crea una cuenta descartable y le copia el corpus de demostración. Es pública, y
la única puerta de entrada a una cuenta ahora que el registro está cerrado.

**`usage`** informa lo que queda: preguntas del día y espacio usado. Es una function y no
una consulta directa porque el cupo se cuenta por IP, y la IP solo la ve el servidor.

**`demo-seed`** carga un documento en el corpus plantilla. Solo con la API key de
administración, desde la línea de comandos.

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

**El cupo se cuenta por IP, no por cuenta.**
Con el registro cerrado y cada visitante recibiendo una cuenta nueva a pedido, un cupo por
cuenta no acota nada: el contador se reinicia con un clic. La IP es la unidad más chica que
un visitante no puede renovar apretando un botón. El costo es real y está asumido: detrás
de un NAT compartido —una oficina, una universidad— todos comparten las mismas 5 preguntas.

**La IP se lee desde la derecha de `x-forwarded-for`, no desde la izquierda.**
Cualquiera puede mandar su propia cabecera `X-Forwarded-For`, y la infraestructura la
extiende en vez de reemplazarla, así que la primera entrada es la que el visitante quiera.
Un pedido desde `190.112.84.146` llega como `190.112.84.146, 10.0.3.7, 3.148.156.80`, y lo
falsificado solo cae más a la izquierda. Contar dos saltos desde la derecha da la entrada
que escribió la infraestructura de InsForge. Si la cadena llegara más corta de lo esperado,
el código devuelve que no hay IP en vez de confiar en una falsificable.

**Las filas de `question_log` sobreviven a la cuenta que las creó.**
`owner_id` es nullable con `ON DELETE SET NULL`. Si las filas se fueran por CASCADE con la
cuenta, la limpieza nocturna le regalaría a esa IP un cupo nuevo cada vez que corriera: el
borrado desharía el límite que justamente tiene que preservar.

**Contar y registrar una pregunta es una sola operación atómica.**
`consume_question` toma un lock por IP, cuenta y registra en la misma transacción.
Separado en dos pasos, dos pedidos concurrentes con el último crédito pasarían los dos.

**Si falla el proveedor de modelos, se devuelve la pregunta.**
Con un cupo de 5 diarias, perder una por un error ajeno al visitante es mala experiencia.
`refund_question` borra el registro cuando la respuesta nunca llegó a generarse.

**`question_log` no tiene políticas RLS, a propósito.**
Sin políticas, `anon` y `authenticated` no pueden tocarla: solo la escriben las functions
con el cliente admin. Si el visitante pudiera borrar sus filas, reiniciaría su propio
límite diario.

**El visitante de la demo recibe una cuenta real, no un modo especial.**
La alternativa —una cuenta compartida, o una excepción en el código— significaría que
todos los visitantes comparten un mismo historial y un mismo cupo. Como la cuenta demo es
una fila de usuario común, pasa exactamente por las mismas políticas RLS que cualquier
otra: el aislamiento entre visitantes es el que la aplicación ya tenía, y no un segundo
mecanismo que podría discrepar del primero.

**El corpus de la demo se embebe una vez y se copia, no se vuelve a embeber.**
`demo_files` / `demo_documents` guardan los vectores sin dueño. Aprovisionar a un
visitante es una copia en SQL: los mismos vectores, sin llamar a OpenRouter. Embeber por
visitante costaría dinero para producir resultados idénticos a los ya guardados.

**Hay un tope diario global por encima del de cada IP.**
Un límite por IP acota a un visitante, no a la factura: conseguir IP es barato. El techo
que realmente limita el gasto es `limit_demo_questions_per_day_global()`, contado sobre
todos los pedidos del día.

**El solapamiento arrastra oraciones completas, no caracteres.**
La primera versión cortaba por cantidad de caracteres y dejaba fragmentos que empezaban a
mitad de palabra (`"o anual de capacitación..."`). Además de verse mal, ensucia el
embedding del fragmento.

**El Markdown se renderiza sin `rehype-raw`.**
El texto viene de un LLM que repite el contenido de archivos subidos por el usuario.
Habilitar HTML crudo sería ejecutar HTML de terceros en la sesión.

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

Todos viven **solo en SQL**. La UI los lee a través de la function `usage` y las functions
los aplican con `reserve_file`, `consume_question` y `provision_demo_user`, así que no
pueden desincronizarse: para cambiarlos se toca una función y nada más.

El de 2 MiB no es arbitrario. Cada fragmento de ~500 tokens ocupa unos 6 KB solo en el
vector (1536 floats × 4 bytes), así que 2 MiB de texto son ~1050 fragmentos ≈ 6,3 MB de
vectores por usuario. En el plan gratuito de InsForge eso deja lugar para varias decenas
de usuarios. En texto plano, 2 MiB son unas 600 páginas.

El día se corta a **medianoche UTC**, no en el huso local.

---

## Modo demo

Tocar **Probar demo** llama a la function `demo`, que:

1. crea un usuario por la API de administración de auth, con una dirección aleatoria bajo
   `@demo.invalid` y una contraseña aleatoria;
2. llama a `provision_demo_user()`, que copia el corpus plantilla a las filas propias de
   ese usuario en `ingested_files` / `documents` y registra la cuenta en `demo_sessions`;
3. devuelve las credenciales de un solo uso, que el navegador usa enseguida para iniciar
   sesión por el camino normal de contraseña.

De ahí en adelante es una sesión común: el visitante puede preguntar, subir sus propios
archivos y borrar cosas, todo dentro de su cuenta y sin tocar la de nadie más. Lo que la
cuenta nueva **no** reinicia es el cupo diario, que sigue a la IP.

Si el aprovisionamiento falla, la function borra el usuario que acababa de crear, así que
un intento rechazado no deja una cuenta colgada.

`demo-cleanup` corre todos los días a las 04:00 UTC y borra las cuentas más viejas que
`limit_demo_lifetime_hours()`. Borrar al usuario arrastra sus archivos, fragmentos, chats
y cupo consumido. Para purgar todas las cuentas demo ahora mismo, se le pasa una ventana
de cero:

```bash
npx -y @insforge/cli functions invoke demo-cleanup --data '{"older_than_hours":0}'
```

### El corpus de la demo

Los seis documentos viven en [`demo-corpus/`](demo-corpus/) y cubren qué es un RAG, cómo
está hecho este proyecto y quién lo hizo, en español e inglés. Son la fuente de verdad
legible; los vectores de la base se derivan de ellos.

Para cargar o recargar uno (es el único paso que gasta embeddings):

```bash
npx -y @insforge/cli functions invoke demo-seed \
  --data "$(node scripts/demo-seed-payload.mjs demo-corpus/que-es-un-rag.md)"
```

Volver a sembrar el mismo nombre reemplaza la versión anterior. En Windows la línea de
comandos tiene un tope de ~32 KB, y por eso el corpus está partido en archivos enfocados
en vez de dos largos — una división que además recupera mejor, por el motivo de
[la medición pendiente](#una-medición-pendiente).

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

Después se siembra el corpus una vez (ver [El corpus de la demo](#el-corpus-de-la-demo)) y
se agenda la limpieza:

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

[`insforge.toml`](insforge.toml) guarda la configuración de auth, y dos valores son
estructurales:

- `disable_signup = true` cierra el registro público. Lo rechaza el backend; la UI no está
  simplemente escondiendo un formulario.
- `require_email_verification = false` es lo que permite que una cuenta demo inicie sesión.
  Las cuentas las crea la API de administración con una dirección `@demo.invalid` donde
  nadie puede leer el correo, así que con la verificación activa se crean y quedan
  bloqueadas.

Los dos van juntos. Desactivar la verificación con el registro abierto permitiría que
cualquiera se registre sin verificar, así que si algún día volvés a abrir `disable_signup`,
reactivá la verificación en el mismo cambio.

El formulario de contraseña también salió de la UI, así que hoy no hay forma de entrar a
una cuenta con nombre. Para reponerlo hay que volver a poner el formulario en
`AuthScreen.tsx` y llamar a `insforge.auth.signInWithPassword`; del lado del backend sigue
funcionando.

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
