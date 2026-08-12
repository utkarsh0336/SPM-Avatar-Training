# Spec: Knowledge Management

## Overview

Lets a trainer/admin upload organizational documents (SOPs, policies, manuals, product docs,
compliance material) into a per-tenant knowledge base. Documents are parsed, chunked, and embedded
into `KnowledgeChunk` rows (pgvector). At conversation time, the avatar's reply is grounded in the
org's own documents before falling back to the LLM's general knowledge, with the source surfaced
back to the caller.

This is SOW §3.3 ("Enterprise Knowledge Management System") and corresponds to `docs/ROADMAP.md`
Phase 3 ("It actually teaches"), scoped down: this feature covers ingestion + retrieval grounding
only. Phase 3's curriculum model and tool registry (`search_knowledge` as an LLM-invoked tool,
`start_checkpoint`, `grade_answer`, `record_progress`) are **not** built here — the current
`LLMProvider` interface (`packages/shared/src/providers/types.ts`) has no tool-calling support in
either the Gemini or Groq adapter, and adding one is a separate, larger change. Grounding in this
phase is retrieve-then-inject: embed the learner's utterance, run a pgvector similarity search
scoped to `org_id`, and prepend matched context to the per-turn system prompt before calling
`llm.chat()`. This matches the "Grounded system-instruction template" line in Phase 3's own
description and is achievable without redesigning the LLM adapters. The tool-registry approach
remains the target for the follow-up Assessment/LMS feature (SOW §3.4/3.5), where
`record_progress`/`grade_answer` are already forward-referenced in `.claude/rules/tenancy.md`.

Scope interpretation: the SOW's Priority 1 ("approved organizational knowledge repository") and
Priority 2 ("uploaded training and reference materials") collapse into one corpus in this platform
— whatever a trainer uploads through the Knowledge Base *is* the approved repository. There is no
separate draft/approval workflow distinguishing the two. A formal review/publish workflow is a
plausible future enhancement, deliberately deferred here (see `docs/ROADMAP.md`'s own "Deliberately
deferred" convention) rather than built speculatively.

---

## Business Goal

Every AI Avatar answer today (`buildSystemPrompt` + `llm.chat`) is generic LLM knowledge with zero
connection to a trainer's actual SOPs, policies, or product docs. This is the platform's namesake
capability and its core differentiator over a bare chatbot. It directly implements the SOW's
Response Priority Hierarchy and its opening-paragraph requirement to "clearly distinguish between
organization-specific knowledge and externally generated content" — without it, the platform cannot
truthfully claim to be a "knowledge management" product at all, and SOW §3.4 (training content),
§3.5 (assessments grounded in real material), and §3.9 ("knowledge utilization" analytics) all stay
blocked on it.

---

## Depends On

- `.claude/specs/ai-avatar.md` (avatar framework, provider boundary)
- `.claude/specs/ai-voice-livekit.md`, `.claude/specs/video-chat-session.md` (realtime pipeline —
  `conversation-service.ts` is the integration point here)
- `.claude/specs/onboarding.md`, `.claude/specs/tenant-branding.md` (org/tenant model, RLS)

---

## Components Affected

- `apps/api` — new upload/list/delete routes, ingestion orchestration, retrieval integration into
  the realtime turn loop
- `apps/dashboard` — new Knowledge Base admin page (upload, status, delete)
- `packages/shared` — new `EmbeddingProvider` adapter + factory, chunking utility, Zod contracts,
  extended WS message schemas
- `prisma` — new `KnowledgeDocument` / `KnowledgeChunk` models, pgvector extension + HNSW index, RLS
- `apps/widget` — **not modified.** Transcript already carries text; learner-facing source-citation
  UI is a deferred enhancement, not required to satisfy SOW §3.3's "source attribution wherever
  applicable" (the *data* is on the wire from this feature; rendering it is optional polish)
- `apps/agent` — **not modified.** Confirmed still a Phase 0 stub (`runWorker()` returns a literal
  placeholder string, no LLM/session wiring exists yet) — there is no LiveKit conversation pipeline
  to ground

---

## API Changes

All routes tenant-scoped via `request.authContext!.orgId` (never from the request body/path),
gated `requireRole("OWNER")` — same pattern as `apps/api/src/routes/org.ts`. Two-tier `Role` enum
(`OWNER`/`MEMBER`) has no finer-grained "content curator" role today; opening this to `MEMBER` is a
one-line change later if the business wants it, not designed in now.

- `POST /v1/knowledge/documents` — multipart upload. Validates mime type (PDF/DOCX/TXT this phase)
  and a size cap (proposed 25MB). Creates a `KnowledgeDocument` row (`status: PENDING`), stores the
  raw file via the storage adapter, kicks off ingestion (parse → chunk → embed → persist) as
  fire-and-forget async work, returns `201` immediately with `{ id, status: "PENDING" }`. Ingestion
  runs out-of-band so the upload response isn't blocked on parsing/embedding a potentially large
  file — see Realtime/Implementation notes on why this is in-process rather than a Redis queue for
  now.
- `GET /v1/knowledge/documents` — list the caller's org documents (id, title, status, chunkCount,
  createdAt), paginated. Used by the dashboard to poll ingestion status.
- `GET /v1/knowledge/documents/:id` — single document detail, including `errorMessage` when
  `status: FAILED`.
- `DELETE /v1/knowledge/documents/:id` — deletes the document row (cascades to its
  `KnowledgeChunk`s) and the underlying stored file.

New Zod contracts live in `packages/shared/src/knowledge/schema.ts`, exported via a new
`@avatrain/shared/knowledge` subpath (matching the existing `./onboarding`, `./org` pattern in
`packages/shared/package.json`).

---

## Database Changes

New enum:

```prisma
enum KnowledgeDocumentStatus {
  PENDING
  PROCESSING
  INDEXED
  FAILED
}
```

New models (tenant-scoped, `org_id` + RLS per `.claude/rules/tenancy.md`):

```prisma
model KnowledgeDocument {
  id               String                   @id @default(uuid()) @db.Uuid
  orgId            String                   @map("org_id") @db.Uuid
  uploadedById     String                   @map("uploaded_by_id") @db.Uuid
  title            String
  originalFilename String                   @map("original_filename")
  mimeType         String                   @map("mime_type")
  fileSizeBytes    Int                      @map("file_size_bytes")
  storageKey       String                   @map("storage_key")
  status           KnowledgeDocumentStatus  @default(PENDING)
  errorMessage     String?                  @map("error_message")
  chunkCount       Int                      @default(0) @map("chunk_count")
  createdAt        DateTime                 @default(now()) @map("created_at")
  updatedAt        DateTime                 @updatedAt @map("updated_at")

  organization Organization     @relation(fields: [orgId], references: [id])
  chunks       KnowledgeChunk[]

  @@index([orgId])
  @@map("knowledge_documents")
}

model KnowledgeChunk {
  id         String   @id @default(uuid()) @db.Uuid
  orgId      String   @map("org_id") @db.Uuid
  documentId String   @map("document_id") @db.Uuid
  chunkIndex Int      @map("chunk_index")
  content    String
  embedding  Unsupported("vector(384)")
  tokenCount Int      @map("token_count")
  createdAt  DateTime @default(now()) @map("created_at")

  organization Organization      @relation(fields: [orgId], references: [id])
  document     KnowledgeDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@index([orgId])
  @@index([documentId])
  @@map("knowledge_chunks")
}
```

Notes:
- `vector(384)` matches the default local embedding model (see Dependencies). Prisma has no native
  pgvector type — `Unsupported(...)` means the `embedding` column is invisible to Prisma Client;
  all reads/writes on it go through `$queryRaw`/`$executeRaw` in `retrieval-service.ts` /
  `knowledge-service.ts`. Switching the embedding provider later to one with a different output
  dimension requires a migration + full re-embed of existing chunks — an accepted, documented
  constraint, not solved generically now.
- Migration must run `CREATE EXTENSION IF NOT EXISTS vector;` (already available — the dev Postgres
  image is `pgvector/pgvector:pg16` per `docker-compose.yml`) and create an HNSW index
  (`USING hnsw (embedding vector_cosine_ops)`) per `docs/ARCHITECTURE.md` §5's explicit guidance.
  Confirm the image's pgvector version supports HNSW (0.5.0+) at implementation time.
- RLS migration follows the exact pattern of `20260808050600_avatars_rls`.
- `KnowledgeChunk.orgId` is denormalized from `KnowledgeDocument.orgId` (not joined for RLS) so the
  RLS policy and the retrieval query itself both filter on an indexed column directly — same
  reasoning as every other tenant-scoped table in the schema today.

---

## UI Changes

**Dashboard** — new `apps/dashboard/app/(dashboard)/knowledge/page.tsx`, mirroring the existing
`settings/page.tsx` structure:
- Upload control (file picker) → `POST /v1/knowledge/documents`.
- Document list with status badge (Pending/Processing/Indexed/Failed), chunk count, uploaded date,
  delete action. Polls `GET /v1/knowledge/documents` on an interval while any document is
  Pending/Processing (plain polling — this is an admin screen, not the realtime audio path, so a
  WebSocket here would be unjustified complexity).

**Widget / Avatar / Analytics** — no changes this phase.

---

## Realtime Changes

Integration point: `apps/api/src/services/conversation-service.ts`'s `processTurn`, between STT
resolving final user text and the `llm.chat()` call — the exact point `.claude/rules/realtime.md`
identifies as the hot path requiring `latency-auditor` review and a `pnpm bench:latency` run on any
diff.

1. The handler's `_claims` parameter (currently unused — prefixed underscore) becomes `claims` and
   its `orgId` is what scopes every retrieval query. This is the only correct source of tenant
   identity here; it must never come from a client-supplied field.
2. Embed the learner's final transcribed text via `createEmbeddingProviderFromEnv()`.
3. Run a pgvector cosine-similarity search (`retrieval-service.ts`) scoped to `claims.orgId`,
   top-k (proposed k=5), with a minimum similarity threshold (proposed 0.35, tunable) — below
   threshold means "nothing relevant," not "weakly relevant," and must not be injected as noise.
4. If matches found: build a context block prepended to that turn's system prompt (regenerated per
   turn — retrieval is query-dependent, so this is never persisted into the rolling `messages`
   history) instructing the model to answer from the provided context when relevant, and to say so
   plainly when it's answering from general knowledge instead. This is the literal implementation
   of the SOW's Priority 1/2 → Priority 3 hierarchy and its "clearly distinguish" requirement.
5. If no matches / below threshold: system prompt is unchanged from today (pure Priority-3 path).
6. The avatar's `transcript` server message gains an optional `sources` field
   (`{ documentId: string; title: string }[]`, omitted when ungrounded) — extends
   `transcriptMessageSchema` in `packages/shared/src/realtime/ws-messages.ts` per that file's own
   rule ("if a message shape is missing, add it there first"). Optional field, so existing clients
   validate unchanged.
7. `latencyMessageSchema` gains an optional `retrievalMs` field; `createTurnLatencyTracker`
   (`packages/shared/src/tutor/latency-log.ts`) gains a `markRetrievalDone()` mark, tracked
   independently of `sttMs` — `docs/ARCHITECTURE.md` §5 states a **<100ms p95** retrieval budget
   explicitly; this must be independently measurable to verify that budget, not folded into an
   existing number.
8. Retrieval failure (embedding provider error, DB error, timeout) must **not** fail the turn —
   degrade to the ungrounded Priority-3 path, matching `docs/ARCHITECTURE.md` §2's "degrade, never
   drop" principle. Log the failure; do not surface it to the learner as an error.
9. Ingestion (upload → parse → chunk → embed → persist) runs out-of-process from any WS connection
   entirely — it is triggered from the REST upload route, not the realtime path, so it has no
   latency budget of its own beyond "don't leave a document stuck in PROCESSING forever." Proposed
   for this phase: simple in-process async work (fire-and-forget after the `201` response), not a
   Redis-backed job queue. Redis is provisioned in `docker-compose.yml` but genuinely unused by any
   app code today (`rate-limit.ts` explicitly calls distributed limiting an "explicit spec
   non-goal" for the same reason: apps/api is single-process, not yet horizontally scaled). Adding a
   queue library ahead of actual need would be scope creep against CLAUDE.md's "don't design for
   hypothetical future requirements." Revisit if/when ingestion volume or apps/api's scaling profile
   actually requires it.

---

## Files to Modify

- `prisma/schema.prisma`
- `apps/api/src/app.ts` (register knowledge routes)
- `apps/api/src/services/conversation-service.ts` (retrieval integration; `_claims` → `claims`)
- `packages/shared/src/realtime/ws-messages.ts` (`transcriptMessageSchema.sources`,
  `latencyMessageSchema.retrievalMs`)
- `packages/shared/src/tutor/latency-log.ts` (`markRetrievalDone`)
- `packages/shared/src/index.ts` (export new pieces)
- `packages/shared/package.json` (new `./knowledge` export subpath)
- `.env.example` (new vars — see Dependencies; not read this session due to permission settings,
  append rather than guess its existing structure at implementation time)

## Files to Create

- `prisma/migrations/<ts>_add_knowledge_management/migration.sql`
- `prisma/migrations/<ts>_knowledge_rls/migration.sql`
- `packages/shared/src/providers/embedding-factory.ts` (+ `.test.ts`)
- `packages/shared/src/providers/embedding-local.ts` (+ `.test.ts`)
- `packages/shared/src/providers/embedding-openai.ts` (+ `.test.ts`) — inert placeholder adapter,
  same shape as the local one, unused unless explicitly configured (see Dependencies)
- `packages/shared/src/knowledge/schema.ts` (+ `.test.ts`)
- `packages/shared/src/knowledge/chunking.ts` (+ `.test.ts`) — pure-TS text splitter, no new deps,
  same "hand-roll a small chunker" precedent as `packages/shared/src/tutor/sentence-chunker.ts`
- `packages/shared/src/knowledge/index.ts`
- `apps/api/src/lib/document-storage.ts` (+ `.test.ts`) — adapter interface + local-filesystem
  implementation; shaped so an S3-compatible implementation slots in later without touching callers
- `apps/api/src/lib/document-parsers/parser-factory.ts` (+ `.test.ts`)
- `apps/api/src/lib/document-parsers/pdf.ts`, `docx.ts`, `txt.ts` (+ `.test.ts` each) — PDF/DOCX/TXT
  only this phase (the SOW's most common SOP/policy formats); PPTX/XLS/CSV/HTML/URL slot into the
  same factory later without redesign
- `apps/api/src/services/knowledge-service.ts` (+ `.test.ts`) — ingestion orchestration and status
  transitions
- `apps/api/src/services/retrieval-service.ts` (+ `.test.ts`) — embed query, similarity search,
  threshold/top-k, org-scoping
- `apps/api/src/routes/knowledge.ts` (+ `.test.ts`)
- `apps/dashboard/app/(dashboard)/knowledge/page.tsx` (+ `.test.tsx`)
- `apps/dashboard/app/(dashboard)/knowledge/DocumentUpload.tsx`
- `apps/dashboard/app/(dashboard)/knowledge/DocumentList.tsx`
- `apps/dashboard/app/(dashboard)/knowledge/page.module.css`

---

## Dependencies

**Requires explicit approval before implementation** — CLAUDE.md: "Never add new dependencies
without approval." None of these are installed yet.

1. **A local embedding runtime** — proposed `@xenova/transformers` running
   `Xenova/all-MiniLM-L6-v2` (384-dim, ONNX, CPU-only, Apache-2.0, no API key, no per-call cost, ~90MB
   model fetched at first run). This is what makes the embedding provider free/self-hosted per the
   agreed constraint (no paid API, no org budget approval needed for this phase). The
   `embedding-openai.ts` adapter is a placeholder for the moment the org approves a paid provider —
   same `EmbeddingProvider` interface, selected via `EMBEDDING_PROVIDER=openai` env, not wired to a
   real key by default.
2. **PDF text extraction** — proposed `pdf-parse` (MIT, no native build step).
3. **DOCX text extraction** — proposed `mammoth` (BSD-2, pure JS, no native deps).

If the user wants zero new dependencies for a first cut, the fallback is TXT-only ingestion (zero
new deps) with PDF/DOCX added once dependency approval clears — flagging this as an option, not
assuming it.

---

## Implementation Rules

- Follow every rule in `CLAUDE.md`
- Never expose `OPENAI_API_KEY` (moot this phase — not added; stays true if/when the OpenAI
  embedding placeholder is ever activated, since it's a server-side-only adapter like every other
  provider)
- Maintain tenant isolation using `org_id` — every knowledge query, embed, and delete is scoped to
  `claims.orgId` / `request.authContext!.orgId`, never a client-supplied org id
- Keep provider-specific logic inside adapters (`EmbeddingProvider`, `DocumentStorage`,
  `DocumentParser` — same shape as the existing `LLMProvider`/`STTProvider`/`TTSProvider` boundary
  enforced by `scripts/verify-provider-boundary.mjs`)
- Validate all public APIs with Zod
- Preserve the public embed SDK contract (unaffected this phase — `apps/widget` untouched)
- Keep realtime latency low — retrieval is on the turn hot path; get `latency-auditor` review and
  `pnpm bench:latency` output before merging any `conversation-service.ts` diff
- Retrieval failure must degrade to ungrounded generation, never fail the turn
- Use strict TypeScript; never use `any`
- Prefer modifying existing code
- Run `pnpm verify`
- Update documentation when public APIs change
- Do not install the dependencies listed above until the user has explicitly approved them

---

## Testing

- **Unit**: chunking boundaries/overlap/edge cases; `embedding-local` output shape/dimension;
  `embedding-factory` env selection; each document parser against fixture files; `retrieval-service`
  threshold and org-scoping behavior (mocked DB); `knowledge-service` status transitions and failure
  handling
- **Integration**: two-org isolation test for both the knowledge routes and retrieval — org A's
  documents must never be readable or retrievable by org B, asserted against real RLS-wrapped
  queries per `.claude/rules/tenancy.md`
- **Realtime tests**: `conversation-service.ts` turn processing with retrieval mocked — grounded
  path, ungrounded/Priority-3 path, retrieval-failure-degrades-gracefully path, `sources` correctly
  attached to the transcript message
- **Latency Benchmarks**: `pnpm bench:latency` including the retrieval step; verify against the
  ARCHITECTURE.md-stated <100ms p95 retrieval budget, or document why not (e.g. cold-start model
  load) and propose a mitigation (warm the embedding model at process boot)
- **Manual Verification**: upload a real PDF SOP through the dashboard, confirm
  PENDING→PROCESSING→INDEXED; start a training session, ask a question answerable only from that
  doc, confirm a grounded answer with source attribution; ask an unrelated question, confirm a
  graceful Priority-3 fallback with no source attribution

---

## Definition of Done

- [ ] Feature works end-to-end (upload → index → grounded answer → source attribution)
- [ ] All tests pass
- [ ] `pnpm verify` passes
- [ ] No lint errors
- [ ] No TypeScript errors
- [ ] Documentation updated
- [ ] Latency budget maintained (retrieval <100ms p95, or documented exception)
- [ ] No security regressions — two-org isolation test passing for every new table/route
- [ ] pgvector HNSW index in place; `scripts/verify-rls.mjs` passes for the new tables
- [ ] Dependency approvals obtained before merge (§Dependencies)
