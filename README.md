# RAG Chatbot

*[Versión en español](README.es.md)*

A chat that answers **only** with what your documents say, and that is allowed to admit
it doesn't know.

**Live: [39237v7a.insforge.site](https://39237v7a.insforge.site)** — no sign-up needed,
click **Probar demo** ("Try the demo").

You upload text files, they get split into chunks and indexed as vectors. When you ask
something, the closest chunks are retrieved and handed to an LLM under a strict
instruction: answer using that context only, and if the answer isn't there, say
`no tengo esa información en mis documentos` ("I don't have that information in my
documents") instead of making something up.

Each user sees only their own documents and chats, with isolation enforced in the
database rather than in application code.

Public registration is closed. The only way in without credentials is the demo button,
which hands you a disposable account that deletes itself — see [Demo mode](#demo-mode).

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
        ingest / ask / demo           │
                                      ├──► OpenRouter  (embeddings + chat)
                                      └──► Postgres    (pgvector + quotas)

Admin only (CLI / schedule)
  └── demo-seed, demo-cleanup ────► Postgres + auth admin API
```

**`ingest`** validates the token, reserves the storage quota, splits the text into chunks
of ~500 tokens with overlap, generates the embeddings in a single batch, and inserts them.

**`ask`** validates the token, deducts one question from the daily allowance, embeds the
query, retrieves the 5 nearest chunks with `match_documents`, and passes them to the LLM
together with the instruction not to step outside that context. It returns the answer and
its sources, each with its similarity score.

**`demo`** creates a disposable account and copies the demo corpus into it. Public, and
the only path to an account now that registration is closed.

**`demo-seed`** loads one document into the template corpus. Admin key only, run from the
CLI.

**`demo-cleanup`** deletes expired demo accounts. Admin key only, run daily by a schedule.

## Data model

| Table | What it's for | Who writes to it |
|---|---|---|
| `documents` | Chunks with their `embedding vector(1536)` | Only the functions (admin client) |
| `ingested_files` | One row per file, with its byte count: this is the quota counter | Functions; the user can delete |
| `conversations` / `messages` | Chat history | The browser, with the user's token |
| `question_log` | Append-only, counts the daily allowance | Only the functions |
| `demo_files` / `demo_documents` | The demo corpus template, with no owner | Only `demo-seed` |
| `demo_sessions` | Marks which accounts are demo, and when they were born | Only `demo` |

Deleting a row from `ingested_files` cascades to its chunks through the foreign key and
frees the quota, so users can manage their own space without intervention.

---

## Design decisions

The ones whose reasoning isn't visible from reading the code.

**`ask` searches with the user's client, not the admin one.**
`match_documents` is `SECURITY INVOKER`, so it runs with the role of whoever calls it. If
the search used the admin client, RLS would be out of the picture and the vector search
would sweep across every user's documents. The policy on `documents` is the only thing
keeping them apart.

**The quota is reserved before a single embedding is generated.**
`reserve_file` inserts the file row and reports whether it fits in the available space.
If anything fails afterwards, that row is deleted and the space comes back. The other way
around — check, work, record — two simultaneous uploads would both slip through on the
last free slot.

**Counting and recording a question is a single atomic operation.**
`consume_question` takes a per-user lock, counts, and records within the same
transaction. Split into two steps, two concurrent requests holding the last credit would
both go through.

**If the model provider fails, the question is refunded.**
With an allowance of 5 per day, losing one to an error that isn't the user's fault is a
bad experience. `refund_question` deletes the record when the answer was never actually
generated.

**`question_log` has no RLS policies, on purpose.**
With no policies, `anon` and `authenticated` cannot touch it: only the functions write to
it, using the admin client. If users could delete their own rows, they would reset their
own daily limit.

**A demo visitor gets a real account, not a special mode.**
The alternative — one shared account, or a bypass in the code — would mean every visitor
sharing one chat history and one allowance. Because the demo account is an ordinary user
row, it goes through exactly the same RLS policies as anyone else, so isolation between
visitors is the isolation the app already had, not a second mechanism that could disagree
with the first.

**The demo corpus is embedded once and copied, not re-embedded.**
`demo_files` / `demo_documents` hold the vectors with no owner. Provisioning a visitor is
a SQL copy: same vectors, no call to OpenRouter. Embedding per visitor would cost money
to produce results identical to the ones already stored.

**The demo has a global daily cap, not just a per-account one.**
A per-account allowance bounds nothing when anyone can ask for a new account. The cap
that actually limits spend is `limit_demo_questions_per_day_global()`; the per-account
one only keeps a single visitor from eating the whole budget.

**The overlap carries whole sentences, not characters.**
The first version cut by character count and left chunks starting mid-word (`"nnual
training plan..."`). Beyond looking bad, it pollutes the chunk's embedding.

**Markdown is rendered without `rehype-raw`.**
The text comes from an LLM echoing the contents of files the user uploaded. Enabling raw
HTML would mean executing third-party HTML in the session.

---

## Per-user limits

| Limit | Normal account | Demo account | Where it lives |
|---|---|---|---|
| Questions per day | 5 | 50 | `limit_questions_per_day()` / `limit_demo_questions_per_day()` |
| Total storage | 2 MiB of text | 2 MiB of text | `limit_storage_bytes()` |
| Size per file | 1 MiB | 1 MiB | `limit_file_bytes()` |

And three that bound the demo as a whole:

| Limit | Value | Where it lives |
|---|---|---|
| Demo questions per day, all accounts | 300 | `limit_demo_questions_per_day_global()` |
| New demo accounts per hour | 20 | `limit_demo_sessions_per_hour()` |
| Demo account lifetime | 24 h | `limit_demo_lifetime_hours()` |

All of them live **in SQL only**. The UI reads them with `my_usage()` and the functions
enforce them through `reserve_file`, `consume_question` and `provision_demo_user`, so they
cannot drift apart: changing one means touching a single function and nothing else.

The 2 MiB figure isn't arbitrary. Each ~500-token chunk takes about 6 KB in the vector
alone (1536 floats × 4 bytes), so 2 MiB of text is ~1050 chunks ≈ 6.3 MB of vectors per
user. On InsForge's free plan that leaves room for several dozen users. In plain text,
2 MiB is roughly 600 pages.

The day rolls over at **UTC midnight**, not in the local time zone.

---

## Demo mode

Clicking **Probar demo** calls the `demo` function, which:

1. creates a user through the auth admin API, with a random address under `@demo.invalid`
   and a random password;
2. calls `provision_demo_user()`, which copies the template corpus into that user's own
   `ingested_files` / `documents` rows and records the account in `demo_sessions`;
3. returns the one-time credentials, which the browser immediately uses to sign in through
   the ordinary password flow.

From there it is a normal session: the visitor can ask, upload their own files, and delete
things, all inside their own account and without touching anyone else's.

If provisioning fails the function deletes the user it just created, so a rejected attempt
doesn't leave an account behind.

`demo-cleanup` runs daily at 04:00 UTC and deletes accounts older than
`limit_demo_lifetime_hours()`. Deleting the user cascades to their files, chunks, chats
and consumed allowance. To purge every demo account right now, pass a zero window:

```bash
npx -y @insforge/cli functions invoke demo-cleanup --data '{"older_than_hours":0}'
```

### The demo corpus

The six documents live in [`demo-corpus/`](demo-corpus/) and cover what RAG is, how this
project is built, and who built it, in Spanish and English. They are the readable source
of truth; the vectors in the database are derived from them.

To load or reload one (this is the only step that spends embeddings):

```bash
npx -y @insforge/cli functions invoke demo-seed \
  --data "$(node scripts/demo-seed-payload.mjs demo-corpus/que-es-un-rag.md)"
```

Seeding the same file name again replaces the previous version. On Windows, the shell caps
the command line at ~32 KB, which is why the corpus is split into focused files rather than
two long ones — a split that also retrieves better, for the reason in
[the pending measurement](#one-measurement-still-pending).

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
npx -y @insforge/cli functions deploy demo --file ./functions/demo.ts
npx -y @insforge/cli functions deploy demo-seed --file ./functions/demo-seed.ts
npx -y @insforge/cli functions deploy demo-cleanup --file ./functions/demo-cleanup.ts
```

Then seed the corpus once (see [The demo corpus](#the-demo-corpus)) and schedule the
cleanup:

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

[`insforge.toml`](insforge.toml) holds the auth settings, and two of them are load-bearing:

- `disable_signup = true` closes public registration. The backend refuses it; the UI isn't
  merely hiding a form.
- `require_email_verification = false` is what lets a demo account sign in. Accounts are
  created by the admin API with a `@demo.invalid` address that no one can read mail at, so
  with verification on they are created and then locked out.

Those two belong together. Turning verification off while registration is open would let
anyone register unverified, so if you ever reopen `disable_signup`, turn verification back
on in the same change.

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

`ingest` and `ask` require a valid `Bearer` token; without one they return 401. `demo`
takes the anon key, like any public function.

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
- **Spend is capped for the demo, not for the project.** The demo's global daily cap
  bounds what anonymous visitors can spend, but a named account still has its own 5 daily
  questions on top of that, and nothing watches the OpenRouter balance itself.
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
