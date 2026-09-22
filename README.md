# RAG Chatbot

*[Versión en español](README.es.md)*

A chat that answers **only** with what your documents say, and that is allowed to admit
it doesn't know.

You upload text files, they get split into chunks and indexed as vectors. When you ask
something, the closest chunks are retrieved and handed to an LLM under a strict
instruction: answer using that context only, and if the answer isn't there, say
`no tengo esa información en mis documentos` ("I don't have that information in my
documents") instead of making something up.

Each user sees only their own documents and chats, with isolation enforced in the
database rather than in application code.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, Tailwind v4 |
| Backend | InsForge — Postgres, auth, edge functions on Deno |
| Vectors | pgvector with an HNSW index and cosine distance |
| Models | OpenRouter — `text-embedding-3-small` (1536 dims) and `gpt-4o-mini` |

## Architecture

```
Browser (Next.js)
  │
  ├── @insforge/sdk ──────────────► Postgres via PostgREST
  │     auth, chats, files           RLS filters by auth.uid()
  │
  └── functions.invoke ───────────► Edge functions (Deno)
        ingest / ask                  │
                                      ├──► OpenRouter  (embeddings + chat)
                                      └──► Postgres    (pgvector + quotas)
```

**`ingest`** validates the token, reserves the storage quota, splits the text into chunks
of ~500 tokens with overlap, generates the embeddings in a single batch, and inserts
them.

**`ask`** validates the token, deducts one question from the daily allowance, embeds the
query, retrieves the 5 nearest chunks with `match_documents`, and passes them to the LLM
together with the instruction not to step outside that context. It returns the answer and
its sources, each with its similarity score.

## Data model

| Table | What it's for | Who writes to it |
|---|---|---|
| `documents` | Chunks with their `embedding vector(1536)` | Only the functions (admin client) |
| `ingested_files` | One row per file, with its byte count: this is the quota counter | Functions; the user can delete |
| `conversations` / `messages` | Chat history | The browser, with the user's token |
| `question_log` | Append-only, counts the daily allowance | Only the functions |

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

**The overlap carries whole sentences, not characters.**
The first version cut by character count and left chunks starting mid-word (`"nnual
training plan..."`). Beyond looking bad, it pollutes the chunk's embedding.

**Markdown is rendered without `rehype-raw`.**
The text comes from an LLM echoing the contents of files the user uploaded. Enabling raw
HTML would mean executing third-party HTML in the session.

---

## Per-user limits

| Limit | Value | Where it lives |
|---|---|---|
| Questions per day | 5 | `limit_questions_per_day()` |
| Total storage | 2 MiB of text | `limit_storage_bytes()` |
| Size per file | 1 MiB | `limit_file_bytes()` |

All three live **in SQL only**. The UI reads them with `my_usage()` and the functions
enforce them through `reserve_file` and `consume_question`, so they cannot drift apart:
changing one means touching a single function and nothing else.

The 2 MiB figure isn't arbitrary. Each ~500-token chunk takes about 6 KB in the vector
alone (1536 floats × 4 bytes), so 2 MiB of text is ~1050 chunks ≈ 6.3 MB of vectors per
user. On InsForge's free plan that leaves room for several dozen users. In plain text,
2 MiB is roughly 600 pages.

The day rolls over at **UTC midnight**, not in the local time zone.

---

## Getting started

Requires Node 20+, an InsForge account, and an OpenRouter key.

```bash
npm install

# Backend: link the project and apply the schema
npx -y @insforge/cli login
npx -y @insforge/cli link --project-id <your-project-id>
npx -y @insforge/cli db migrations up --all

# The OpenRouter key goes in as a backend secret, never in the repo.
# Secrets are injected at deploy time: if you rotate it, both functions
# have to be redeployed to pick it up.
npx -y @insforge/cli secrets add OPENROUTER_API_KEY sk-or-v1-...
npx -y @insforge/cli functions deploy ingest --file ./functions/ingest.ts
npx -y @insforge/cli functions deploy ask --file ./functions/ask.ts
```

`.env.local` with your project's values:

```bash
NEXT_PUBLIC_INSFORGE_URL=https://<your-project>.insforge.app
NEXT_PUBLIC_INSFORGE_ANON_KEY=anon_...
```

Both are public by design: the anonymous key only unlocks what the RLS policies allow.
The admin key never leaves the backend.

```bash
npm run dev
```

### The endpoints over HTTP

Both functions require a valid `Bearer` token; without one they return 401.

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
- **No global spend cap.** Sign-up is open, and every new user means 5 daily questions
  against the project owner's OpenRouter key.
- **Retrieval without a threshold.** `match_documents` always returns the 5 nearest
  chunks, even when they're irrelevant; the filtering is left to the model's prompt.
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
