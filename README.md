# RAG Chatbot

*[Versión en español](README.es.md)*

A chat that answers **only** with what your documents say, and that is allowed to admit
it doesn't know.

**Live: [ragchatbot.insforge.site](https://ragchatbot.insforge.site)** — no sign-up needed,
click **Probar demo** ("Try the demo").

You upload text files, they get split into chunks and indexed as vectors. When you ask
something, the closest chunks are retrieved and handed to an LLM under a strict
instruction: answer using that context only, and if the answer isn't there, say
`no tengo esa información en mis documentos` ("I don't have that information in my
documents") instead of making something up.

Each visitor sees only their own documents and chats.

There are no passwords and no sign-up form: registration is closed in the backend and the
password flow is turned off for now. Everyone who arrives gets a disposable account of
their own, and the daily allowance is counted per IP address rather than per account —
see [Demo mode](#demo-mode).

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, Tailwind v4 |
| Backend | InsForge — Postgres, auth, edge functions on Deno |
| Vectors | pgvector with an HNSW index and cosine distance |
| Models | OpenRouter — `text-embedding-3-small` (1536 dims) and `gpt-4o-mini` |
| Hosting | InsForge deployments (Vercel underneath) |

## Architecture

```
Browser (Next.js)
  │
  ├── @insforge/sdk ──────────────► Postgres via PostgREST
  │     auth, chats, files           RLS filters by auth.uid()
  │
  └── functions.invoke ───────────► Edge functions (Deno)
        demo / ingest / ask / usage   │
                                      ├──► OpenRouter  (embeddings + chat)
                                      └──► Postgres    (pgvector + quotas)

Admin only (CLI / schedule)
  └── demo-seed, demo-cleanup ────► Postgres + auth admin API
```

**`ingest`** splits a document into ~500-token chunks, embeds them and stores them.

**`ask`** embeds the question, retrieves the 5 nearest chunks with `match_documents` and
returns the LLM's answer plus its sources.

**`demo`** creates a disposable account with the demo corpus already loaded.

**`usage`** returns the questions left for the day and the storage used.

**`demo-seed`** loads one document into the template corpus. Admin key only.

**`demo-cleanup`** deletes expired demo accounts. Admin key only, run daily by a schedule.

## Data model

| Table | What it's for | Who writes to it |
|---|---|---|
| `documents` | Chunks with their `embedding vector(1536)` | Only the functions (admin client) |
| `ingested_files` | One row per file, with its byte count: this is the quota counter | Functions; the user can delete |
| `conversations` / `messages` | Chat history | The browser, with the user's token |
| `question_log` | Append-only, counts the daily allowance per IP | Only the functions |
| `demo_files` / `demo_documents` | The demo corpus template, with no owner | Only `demo-seed` |
| `demo_sessions` | Marks which accounts are demo, and when they were born | Only `demo` |

---

## Limits

| Limit | Value | Counted per | Where it lives |
|---|---|---|---|
| Questions per day | 5 | IP address | `limit_questions_per_ip_per_day()` |
| Total storage | 2 MiB of text | account | `limit_storage_bytes()` |
| Size per file | 1 MiB | file | `limit_file_bytes()` |

And three that bound the system as a whole:

| Limit | Value | Where it lives |
|---|---|---|
| Questions per day, everyone combined | 300 | `limit_demo_questions_per_day_global()` |
| New demo accounts per hour | 20 | `limit_demo_sessions_per_hour()` |
| Demo account lifetime | 24 h | `limit_demo_lifetime_hours()` |

The day rolls over at **UTC midnight**, not in the local time zone.

---

## Demo mode

Clicking **Probar demo** creates a disposable account with the sample corpus from
[`demo-corpus/`](demo-corpus/) already loaded — six documents on what RAG is, how this
project is built, and who built it, in Spanish and English. The account is deleted after
24 hours. The daily allowance is counted per IP, so a new account does not reset it.

Load or reload one document into the template corpus (the only step that spends
embeddings; seeding the same file name again replaces the previous version):

```bash
npx -y @insforge/cli functions invoke demo-seed \
  --data "$(node scripts/demo-seed-payload.mjs demo-corpus/que-es-un-rag.md)"
```

Delete expired demo accounts. This runs daily at 04:00 UTC; a zero window purges every
demo account right now:

```bash
npx -y @insforge/cli functions invoke demo-cleanup --data '{"older_than_hours":0}'
```

---

## Getting started

Requires Node 20+, an InsForge account, and an OpenRouter key.

```bash
npm install

# Backend: link the project and apply the schema
npx -y @insforge/cli login
npx -y @insforge/cli link --project-id <your-project-id>
npx -y @insforge/cli db migrations up --all

# Auth settings live in insforge.toml and are applied as code
npx -y @insforge/cli config apply

# The OpenRouter key goes in as a backend secret, never in the repo.
# Secrets are injected at deploy time: if you rotate it, the functions
# have to be redeployed to pick it up.
npx -y @insforge/cli secrets add OPENROUTER_API_KEY sk-or-v1-...
npx -y @insforge/cli functions deploy ingest --file ./functions/ingest.ts
npx -y @insforge/cli functions deploy ask --file ./functions/ask.ts
npx -y @insforge/cli functions deploy usage --file ./functions/usage.ts
npx -y @insforge/cli functions deploy demo --file ./functions/demo.ts
npx -y @insforge/cli functions deploy demo-seed --file ./functions/demo-seed.ts
npx -y @insforge/cli functions deploy demo-cleanup --file ./functions/demo-cleanup.ts
```

Then seed the corpus once (see [Demo mode](#demo-mode)) and schedule the cleanup:

```bash
npx -y @insforge/cli schedules create \
  --name "Demo cleanup" \
  --cron "0 4 * * *" \
  --url "https://<your-project>.insforge.app/functions/demo-cleanup" \
  --method POST \
  --headers '{"Authorization":"Bearer ${{secrets.API_KEY}}","Content-Type":"application/json"}' \
  --body '{}'
```

### Auth configuration

[`insforge.toml`](insforge.toml) holds the auth settings. `disable_signup = true` and
`require_email_verification = false` go together: if you ever reopen registration, turn
verification back on in the same change.

### Environment variables

`.env.local` for local development:

```bash
NEXT_PUBLIC_INSFORGE_URL=https://<your-project>.insforge.app
NEXT_PUBLIC_INSFORGE_ANON_KEY=anon_...
```

Both are public by design: the anonymous key only unlocks what the RLS policies allow.
The admin key never leaves the backend.

The deployed build doesn't read `.env.local` — the upload excludes `.env*` — so the same
two values are stored as deployment env vars:

```bash
npx -y @insforge/cli deployments env set NEXT_PUBLIC_INSFORGE_URL https://<your-project>.insforge.app
npx -y @insforge/cli deployments env set NEXT_PUBLIC_INSFORGE_ANON_KEY anon_...
npx -y @insforge/cli deployments deploy .
```

```bash
npm run dev
```

### The endpoints over HTTP

`ingest`, `ask` and `usage` require a valid `Bearer` token; without one they return 401.
`demo` takes the anon key, like any public function.

```bash
curl -X POST "https://<your-project>.insforge.app/functions/ingest" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"source": "manual.md", "text": "..."}'

curl -X POST "https://<your-project>.insforge.app/functions/ask" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"question": "What does the manual say about maintenance?"}'
```

---

## Status and known limitations

What it doesn't do yet, stated plainly:

- **Plain text only** (`.txt`, `.md`, `.csv`, `.json`). No PDF.
- **No conversational memory.** Each question travels to the model on its own: earlier
  messages are stored and displayed, but they don't go into the prompt. An "and how much
  is the Pro one?" after a table won't work.
- **No streaming.** The answer appears all at once when it's done.
- **Retrieval without a threshold.** `match_documents` always returns the 5 nearest
  chunks, even when they're irrelevant; the filtering is left to the model's prompt.
- **The IP limit is a speed bump, not a wall.** It stops casual repeat use; it does not
  stop anyone with a VPN or a phone on mobile data. The global daily cap is what actually
  bounds the bill, and nothing watches the OpenRouter balance itself.
- **Shared IPs share the allowance.** Behind an office or campus NAT, the first five
  questions of the day use up everyone's.
- **The demo corpus is duplicated per visitor.** 16 chunks ≈ 100 KB of vectors per demo
  account. Fine at this scale; a shared read-only corpus would scale better.
- **`demo-seed` repeats `ingest`'s chunking code.** Edge functions deploy as single files
  with no shared module, so the two copies have to be kept in sync by hand.
- **No automated tests.**

### One measurement still pending

Something came up during development that's worth writing down: with 500-token chunks
over short documents, similarity scores drop to ~0.35, and in one test the correct chunk
came in **second** (0.3505 against 0.3698 for an irrelevant one). The answer still came
out right, because with few chunks and `match_count: 5` everything makes it into the
context and the model does the filtering.

The embeddings aren't the problem: checked directly against OpenRouter, they give 0.86
between paraphrases and 0.15 between unrelated topics. What happens is that a 500-token
chunk can cover two different topics, and that dilutes the signal. With shorter, more
focused documents the scores rise to 0.55-0.67 and the ordering corrects itself.

Closing this out calls for an evaluation set with retrieval metrics (recall@k, MRR) and a
sweep over chunk sizes. It's the natural next step for the project.
