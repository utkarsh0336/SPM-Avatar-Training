# Spec: Knowledge Search & Ingestion Queue

## Overview

Continues the Knowledge Management feature line (`.claude/specs/knowledge-management.md`,
`.claude/specs/knowledge-document-lifecycle.md`) with the two remaining, well-scoped items from the
platform's own gap assessment:

1. **Standalone knowledge-base search** — a search endpoint and dashboard UI that let a trainer
   query their org's indexed knowledge directly, outside a live avatar conversation turn. Today the
   only way to see what a document's chunks actually contain, or whether a query would ground an
   answer, is to start a real training session and ask.
2. **Ingestion queue/worker** — moves ingestion (parse → chunk → embed → persist) off the API
   process's in-memory fire-and-forget call onto a Redis-backed job queue (BullMQ) consumed by a
   separate worker process, so a mid-job process restart no longer silently strands a document in
   `PROCESSING` forever.

The connectors item (shared folders, internal repos, product catalogs, website crawling) is
explicitly **out of scope** — it bundles several distinct third-party integrations, each needing its
own provider choice and OAuth credentials, which is a product decision, not an engineering one.
Deferred pending that decision.

Both items reuse existing, already-built pieces: search reuses `retrieveContext()`
(`retrieval-service.ts`) unchanged; the queue reuses `ingestDocument()` unchanged, only changing
*what triggers it*.

---

## Business Goal

**Search**: a trainer uploading a document has no way to verify it actually indexed usefully — the
UI shows PENDING → INDEXED and a chunk count, but not *what's searchable*. When a live session gives
an ungrounded answer, there's no way to check whether that's because the content isn't there, isn't
chunked well, or the query just didn't phrase like the source text. Standalone search closes that
diagnostic gap and matches SOW §3.3's own framing of the knowledge base as something a trainer
curates and can verify, not just a black box the avatar consumes.

**Ingestion queue**: `.claude/specs/knowledge-management.md`'s own Realtime Changes §9 explicitly
flagged in-process fire-and-forget ingestion as a decision to revisit once "ingestion volume or
`apps/api`'s scaling profile actually requires it" — deliberately deferred then, not forgotten. A
document stuck in `PROCESSING` after a deploy or crash today requires a re-upload (silent data-
freshness gap: the trainer has no signal it happened) or manual DB surgery. A durable, retryable
queue fixes this without expanding apps/api's own footprint (Redis is already provisioned in
`docker-compose.yml` and has been unused since Phase 0).

---

## Depends On

- `.claude/specs/knowledge-management.md` (retrieval pipeline, storage adapter)
- `.claude/specs/knowledge-document-lifecycle.md` (`ingestStoredDocument` — the storage-backed
  re-ingestion helper this spec's worker reuses directly; was named `reindexAndPromote` there,
  generalized here)

---

## Components Affected

- `apps/api` — new search route, new `IngestionQueue` adapter + BullMQ implementation, new worker
  entrypoint (`src/worker.ts`)
- `apps/dashboard` — new search UI on the Knowledge Base page
- `packages/shared` — new Zod contracts for the search request/response
- `docker-compose.yml` / root `package.json` / `turbo.json` — worker process wired into local dev
- No `prisma/schema.prisma` changes — BullMQ persists job state in Redis, not Postgres

---

## API Changes

- **`GET /v1/knowledge/search?q=...&topK=...`** (new) — OWNER-gated, same pattern as every other
  knowledge route. Calls `retrieveContext(orgId, q, { topK })` directly (the exact function the
  realtime turn loop uses) and returns each matched chunk with its source: `{ documentId, title,
  content, similarity }[]`. `q` is required (400 if missing/blank); `topK` optional, capped at 20
  (search is an admin diagnostic tool, not a retrieval-budget-constrained realtime call — no `<100ms`
  budget applies here, this is not on the turn hot path).
- No changes to any existing endpoint's request/response shape. The ingestion queue is purely an
  internal triggering-mechanism change — `POST /v1/knowledge/documents` and
  `POST /v1/knowledge/documents/:id/versions` keep their existing `202`-immediately,
  `PENDING`-then-async-status-transitions contract unchanged from the caller's perspective.

New Zod contracts in `packages/shared/src/knowledge/schema.ts`: `knowledgeSearchQuerySchema`,
`knowledgeSearchResultSchema`, `knowledgeSearchResponseSchema`.

---

## Database Changes

No database changes. BullMQ's job state (queue contents, retry counts, failure reasons) lives
entirely in Redis, addressed by `documentId`/`orgId` back into the existing `KnowledgeDocument`
table — no new tables, no new columns.

---

## UI Changes

**Dashboard** (`apps/dashboard/app/(dashboard)/knowledge/`):

- New `KnowledgeSearch.tsx` — a search input + results list rendered above or beside the document
  list on the existing Knowledge Base page. Each result shows the matched chunk's text, its source
  document title (linking conceptually to the document row, not a separate page), and similarity
  score. Empty state distinguishes "no query yet" from "query ran, nothing matched" (the latter is
  meaningful diagnostic signal — it tells the trainer their content genuinely isn't there for that
  phrasing).
- Reuses the existing `SearchIcon` from `apps/dashboard/app/sessions/icons.tsx` (already present, not
  a new addition).
- `KnowledgeBase.tsx` gains the new component; no changes to its existing upload/list/edit/version
  state, since search is read-only and independent of document CRUD.

**Widget / Avatar / Analytics** — no changes.

---

## Realtime Changes

None to the turn loop itself. Two points worth being explicit about, since both touch code adjacent
to the hot path:

1. `retrieveContext()` itself is **unchanged** — search calls the exact same function
   `conversation-service.ts` calls, with the exact same org-scoping and threshold behavior. No new
   parameter changes its behavior for the realtime caller.
2. Switching ingestion from in-process fire-and-forget to enqueue-then-worker changes *when* a
   document's chunks become available for retrieval (queue-and-worker latency instead of immediate
   in-process start), but retrieval itself only ever reads `status: INDEXED` documents that already
   have persisted chunks — an in-flight queued job is invisible to any turn's retrieval query exactly
   as an in-flight in-process ingestion was before. No behavior change on the read side.

---

## Ingestion Queue Design

- **Library**: `bullmq@5.81.3` (approved — see Dependencies). Deliberately **not** the `6.x` line:
  both `bullmq@6.x` and its bundled-by-6.x peer `ioredis@6.x` are ~2 weeks old at time of writing
  with frequent patch churn, a real production-reliability risk for infrastructure whose whole job is
  *not losing work on restart*. `5.81.3` is the last release of a long-lived, extensively patched v5
  line and bundles a mature `ioredis@5.11.1` directly (no separate `ioredis` install needed).
- **New adapter** `apps/api/src/lib/ingestion-queue.ts`, matching the existing `DocumentStorage`/
  `EmbeddingProvider` adapter-interface precedent:
  ```ts
  export interface IngestionQueue {
    enqueue(orgId: string, documentId: string): Promise<void>;
  }
  ```
  `createBullMqIngestionQueue()` — real implementation, one BullMQ `Queue` named
  `"knowledge-ingestion"`, connection from `REDIS_URL` (new env var, default
  `redis://localhost:6379` matching `docker-compose.yml`'s exposed port). Job payload is just
  `{ orgId, documentId }` — never file bytes (BullMQ persists job data in Redis; a 25MB payload
  there is wasteful and unnecessary when `DocumentStorage.read()` already exists for exactly this).
  Job options: `attempts: 3`, exponential `backoff`, so a transient embedding-provider hiccup
  self-heals without trainer intervention.
- **`ingestStoredDocument(orgId, documentId, deps?)`** (renamed from `knowledge-document-
  lifecycle.md`'s `reindexAndPromote`, generalized — same body: resolve parser from the document's
  stored `mimeType`, read bytes via `DocumentStorage.read(storageKey)`, call `ingestDocument()`).
  This becomes the **one shared body** for three callers: the new worker's job handler,
  `restoreVersion()`, and `deleteDocument()`'s promotion path (both already existed pre-this-spec)
  — no logic duplication.
- **`KnowledgeServiceDeps`** gains `ingestionQueue?: IngestionQueue`. `uploadDocument()`/
  `uploadNewVersion()` change from `void ingestDocument(...)` to
  `await (deps.ingestionQueue ?? createIngestionQueueFromEnv()).enqueue(orgId, documentId)` when
  `autoIngest` (default true) is set — `autoIngest: false` keeps meaning exactly what it means in
  every existing test today: "don't auto-trigger anything, I'll drive ingestion myself" — since
  every existing service-layer test already sets this explicitly, **zero existing service-layer
  tests need to change**.
- **New worker entrypoint** `apps/api/src/worker.ts` — a `BullMQ Worker` for `"knowledge-ingestion"`,
  handler calls `ingestStoredDocument(job.data.orgId, job.data.documentId)`. Preloads the local
  embedding model at startup via the existing `preloadLocalEmbeddingModel()` (same reasoning
  `index.ts` already documents: avoid a cold-start ONNX load stalling the first real job). Concurrency
  configurable (default a small fixed number — ingestion is I/O/CPU-bound per job, not something to
  fan out unbounded on a single-process worker).
- **Local dev wiring**: `apps/api/package.json` gains a `"worker"` script
  (`tsx watch --env-file=../../.env src/worker.ts`, mirroring the existing `"dev"` script exactly).
  `turbo.json` gains a `worker` task (`{ "cache": false, "persistent": true }`). Root `package.json`'s
  `dev` script changes from `turbo run dev --parallel` to `turbo run dev worker --parallel` so
  `pnpm dev` starts the worker alongside every app's own dev server automatically — without this, a
  fresh `pnpm dev` would silently leave every uploaded document stuck in `PENDING` forever, which is
  a worse failure mode than what this spec is fixing.

---

## Files to Modify

- `apps/api/src/services/knowledge-service.ts` — `uploadDocument()`/`uploadNewVersion()` switch to
  enqueueing; rename+generalize `reindexAndPromote` → `ingestStoredDocument` (exported); add
  `IngestionQueue` to `KnowledgeServiceDeps`
- `apps/api/src/routes/knowledge.ts` — new `GET /v1/knowledge/search` route
- `apps/api/src/index.ts` — no functional change expected, confirm still correct now that ingestion
  no longer runs in this process
- `apps/api/package.json` — new `bullmq` dependency, new `worker` script
- `packages/shared/src/knowledge/schema.ts` — new search Zod contracts
- `apps/dashboard/lib/api-client.ts` — new `searchKnowledge()` function
- `apps/dashboard/app/(dashboard)/knowledge/KnowledgeBase.tsx` — mount `KnowledgeSearch`
- `turbo.json`, root `package.json` — `worker` task wiring
- `.env.example` — new `REDIS_URL` var (not read this session per permission settings; append,
  don't guess existing structure)

## Files to Create

- `apps/api/src/lib/ingestion-queue.ts` (+ `.test.ts`) — `IngestionQueue` interface,
  `createBullMqIngestionQueue()`, `createIngestionQueueFromEnv()`
- `apps/api/src/worker.ts` — the worker process entrypoint (thin — construction + shutdown handling;
  the actual job logic lives in `ingestStoredDocument()`, already tested)
- `apps/dashboard/app/(dashboard)/knowledge/KnowledgeSearch.tsx` (+ `.test.tsx`)

---

## Dependencies

**Requires explicit approval before implementation** — none of these are installed yet.

1. **`bullmq@5.81.3`** — Redis-backed job queue/worker library. Pinned to the mature v5 line, not
   the ~2-week-old `6.x` line (see Ingestion Queue Design above for the specific reasoning). Bundles
   a compatible `ioredis@5.11.1` directly; no separate `ioredis` install needed.

No new dependencies for search — it's a thin route over the already-built `retrieveContext()`.

---

## Implementation Rules

- Follow every rule in `CLAUDE.md`
- Maintain tenant isolation — the search route scopes to `request.authContext!.orgId` exactly like
  every other knowledge route; the worker's job handler receives `orgId` from the job payload
  (server-enqueued, never client-supplied) and passes it straight into `withOrg()`
- `retrieveContext()` itself must not change behavior for its realtime caller — search is a new
  *caller*, not a modified function
- The `IngestionQueue` interface keeps BullMQ specifics out of `knowledge-service.ts`, matching the
  existing `DocumentStorage`/`EmbeddingProvider` adapter boundary
  (`scripts/verify-provider-boundary.mjs` gains a `bullmq` entry restricted to `ingestion-queue.ts`)
- Use strict TypeScript; never use `any`
- Prefer modifying existing code — `ingestDocument()`'s internals are untouched by this spec; only
  what calls it changes
- Run `pnpm verify`
- Do not install `bullmq` until the user has explicitly approved it

---

## Testing

- **Unit**: `ingestion-queue.test.ts` — `createBullMqIngestionQueue().enqueue()` adds a job with the
  expected name/payload/options to a real (test-scoped) Redis queue, verifiable via BullMQ's own
  `Queue.getJobs()`
- **Integration**: search route — results shape, org isolation (org A never sees org B's chunks,
  reusing the existing `oneHotEmbeddingProvider`-seeded pattern from `retrieval-service.test.ts`),
  empty-query 400, empty-result-set 200 with `[]`
- **Worker**: a dedicated test file instantiates a real `Worker` against the same test Redis
  instance, enqueues a job via the real `IngestionQueue`, and asserts the target document reaches
  `INDEXED` — the one place this spec deliberately exercises the real queue+worker path end-to-end
  rather than mocking it away, since that wiring is the entire point of the feature
- **HTTP route tests** (`knowledge.test.ts`) that need a document at `INDEXED` continue using the
  existing pattern of calling `ingestStoredDocument()` directly with a fake embedding provider after
  the HTTP upload — deterministic, no real queue/worker involved, matching every existing test in
  that file today
- **Manual Verification**: `pnpm dev`, upload a document, confirm it reaches `INDEXED` without any
  extra manual step (worker picks it up automatically); kill the worker process mid-ingestion, restart
  it, confirm the stuck job resumes/retries rather than staying `PROCESSING` forever; run a search
  query in the dashboard against real indexed content and confirm results match what a live session
  would ground on

---

## Definition of Done

- [ ] Search endpoint + dashboard UI work end-to-end against real indexed content
- [ ] Uploading a document via the dashboard with only `pnpm dev` running (no manual worker step)
      reaches `INDEXED` automatically
- [ ] Killing the worker process mid-job and restarting it does not strand the document in
      `PROCESSING` — the job resumes or retries
- [ ] All tests pass, including the one real queue+worker integration test
- [ ] `pnpm verify` passes
- [ ] No lint errors, no TypeScript errors
- [ ] Documentation updated (`.env.example` `REDIS_URL`, this spec)
- [ ] No security regressions — search route two-org isolation test passing
- [ ] `bullmq` dependency approval obtained before merge
