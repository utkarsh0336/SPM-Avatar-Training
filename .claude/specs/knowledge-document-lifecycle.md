# Spec: Knowledge Document Lifecycle

## Overview

Extends the Knowledge Management feature (`.claude/specs/knowledge-management.md`) along three axes
that spec explicitly deferred:

1. **More ingestible formats** — PPTX, XLSX, CSV, HTML, added to the existing
   `apps/api/src/lib/document-parsers/parser-factory.ts` dispatch table alongside PDF/DOCX/TXT.
2. **Categorization / tagging** — a freeform `category` and `tags[]` on every `KnowledgeDocument`,
   with dashboard UI to set and filter by them.
3. **Document version control** — re-uploading an updated file for an existing document creates a
   new *version* of that document (tracked, orderable, restorable) instead of an unrelated row that
   sits side-by-side with the stale one in retrieval.

Single-URL fetch and multi-page website crawling are explicitly **out of scope** here — both need
SSRF-safe outbound-fetch infrastructure that belongs with the separate, not-yet-built "connectors"
work (shared folders, internal repos, product catalogs, website crawling), not with file-format
parsing. Standalone knowledge-base search (outside a live conversation turn) is also out of scope —
a separate deferred item.

No new pipeline stages: ingestion is still parse → chunk → embed → persist, retrieval is still a
single pgvector similarity query. This spec only widens what `parse` accepts and adds two orthogonal
columns/behaviors to the document row itself.

---

## Business Goal

Trainers' real material isn't limited to PDF/DOCX/TXT — product catalogs and sales enablement live
in PPTX/XLSX, structured data ships as CSV, exported wiki/help-center pages are HTML. Without these
formats, a meaningful slice of "the approved organizational knowledge repository" (SOW §3.3) simply
can't be uploaded, and PPTX specifically is named in `docs/ROADMAP.md` Phase 3's own ingestion list
("PDF/DOCX/PPTX/MP4").

Version control closes a real correctness gap, not just a UX one: today, re-uploading an updated SOP
creates a second, unrelated `KnowledgeDocument`. Both the stale and current copies get embedded and
both are searched — nothing prevents the avatar from grounding an answer in outdated material. For a
product whose entire pitch is "grounded in the org's own documents," that's a trust-breaking defect.

Categorization/tagging is lower-stakes but compounds: as an org's document count grows past a
handful, an unstructured flat list becomes unmanageable for a trainer maintaining the knowledge base.

---

## Depends On

`.claude/specs/knowledge-management.md` — this spec only extends the `KnowledgeDocument` row shape,
the parser dispatch table, and the retrieval query's `WHERE` clause. It does not change the
ingestion pipeline's stages, the embedding provider, the chunking algorithm, or the grounding
system-prompt logic.

---

## Components Affected

- `apps/api` — new parsers, extended upload/list routes, new version/metadata routes, retrieval
  query scoping
- `apps/dashboard` — extended Knowledge Base admin page (format hints, category/tag UI, version
  history UI)
- `packages/shared` — extended Zod contracts, new mime types
- `prisma` — new columns + indexes on `KnowledgeDocument`, one migration

`apps/widget` and `apps/agent` are unaffected — same reasoning as the parent spec (no learner-facing
UI change; `apps/agent` is still a Phase 0 stub).

---

## API Changes

All routes remain tenant-scoped via `request.authContext!.orgId`, gated `requireRole("OWNER")` —
same pattern as the parent spec, unchanged here.

- **`POST /v1/knowledge/documents`** (existing, extended) — multipart body gains two optional text
  fields alongside `file`: `category` (string, ≤100 chars) and `tags` (JSON-encoded string array,
  ≤20 tags, each ≤50 chars — sent as a single multipart text field since HTML forms/`FormData` don't
  natively repeat array fields well; parsed server-side with `JSON.parse` inside a try/catch that
  falls back to `badRequest("invalid_tags", ...)` on malformed input). Both default to `null`/`[]`
  when omitted. Mime-type validation now accepts the four new types (see Dependencies).
- **`PATCH /v1/knowledge/documents/:documentId`** (new) — JSON body
  `{ category?: string | null; tags?: string[] }`, Zod-validated. Updates only these fields on the
  target row (whichever version it is — editing metadata on a historical version is allowed and
  intentionally does not touch other versions in its lineage). `404` if not found in-org.
- **`GET /v1/knowledge/documents`** (existing, extended) — now returns **one row per document
  lineage** (the highest-`version` row in each lineage — see Database Changes), not one row per
  historical version; this keeps the main list exactly as uncluttered as it is today while still
  surfacing in-flight/failed re-upload attempts (see Realtime Changes note on why this is
  highest-`version`, not `isLatest`). Gains two optional query params: `category` (exact match) and
  repeatable `tag` (array-containment match, ANY-of semantics) — a modest client-side-list filter,
  not a search endpoint (that remains a separate deferred item).
- **`POST /v1/knowledge/documents/:documentId/versions`** (new) — multipart upload (`file` +
  optional `title` text field), creates the next version in the same lineage as `:documentId`.
  Inherits `title`/`category`/`tags` from the lineage's current latest row unless `title` is
  explicitly supplied. Returns `201` with `{ id, version, status: "PENDING" }`, same fire-and-forget
  ingestion pattern as the parent spec. The new row does **not** become the lineage's grounded
  version until its ingestion succeeds — see Realtime Changes.
- **`GET /v1/knowledge/documents/:documentId/versions`** (new) — all rows sharing `:documentId`'s
  lineage, ordered by `version` desc: `{ id, version, title, originalFilename, fileSizeBytes,
  status, chunkCount, isLatest, uploadedById, createdAt }[]`.
- **`POST /v1/knowledge/documents/:documentId/versions/:versionId/restore`** (new) — makes
  `:versionId` (which must be in the same lineage as `:documentId` and must have `status: INDEXED`
  — restoring a `FAILED`/`PENDING` row would ground the avatar in nothing) the lineage's active
  grounded version. `409 version_not_restorable` if the target isn't `INDEXED`. Implemented via the
  same atomic "flip `isLatest`" helper the ingestion-success path uses (see Realtime Changes) — no
  content is copied or re-embedded, since the target row's chunks/embeddings already exist untouched.
- **`DELETE /v1/knowledge/documents/:documentId`** (existing, extended semantics) — deletes exactly
  the targeted version row (cascades to its chunks, as today). If the deleted row was the lineage's
  `isLatest` row, the highest-`version` remaining row in that lineage with `status: INDEXED` is
  promoted to `isLatest` (skipping `FAILED`/`PENDING` rows, which can't ground). If no such row
  remains, the lineage is left with no `isLatest` row (grounding goes quiet for it, no error — same
  "degrade, never drop" principle as a below-threshold retrieval miss). If it was the only row in the
  lineage, behavior is identical to today: the document is gone.

New/extended Zod contracts stay in `packages/shared/src/knowledge/schema.ts`.

---

## Database Changes

Extends `KnowledgeDocument` (no new tables, no RLS changes — `org_id` and its existing policy are
untouched by this spec):

```prisma
model KnowledgeDocument {
  // ...existing fields unchanged...

  category  String?  @db.VarChar(100)
  tags      String[] @default([])

  lineageId String   @default(uuid()) @map("lineage_id") @db.Uuid
  version   Int      @default(1)
  isLatest  Boolean  @default(true) @map("is_latest")

  // ...existing relations unchanged...

  @@index([orgId, category])
  @@unique([lineageId, version])
  @@map("knowledge_documents")
}
```

Notes:
- `lineageId` defaults to a fresh UUID on every `create()` call that doesn't explicitly copy one
  forward — a brand-new upload is implicitly version 1 of its own new lineage; `uploadNewVersion()`
  is the only code path that explicitly copies an existing `lineageId` onto a new row.
- No GIN index on `tags` this phase. Per-org document counts are small (an admin-curated knowledge
  base, not user-generated content at scale) — a `tags @> ARRAY[$tag]` containment check on the
  `orgId`-filtered subset is fine without one. Revisit only if this becomes measurably slow; adding
  it speculatively would be scope creep against CLAUDE.md's "don't design for hypothetical future
  requirements."
- `@@unique([lineageId, version])` prevents two rows in the same lineage from ever claiming the same
  version number, even under concurrent version uploads.
- One migration (`prisma/migrations/<ts>_knowledge_document_lifecycle/migration.sql`) covers all of
  the above — no RLS migration needed since no new tenant-scoped table is introduced.

---

## UI Changes

**Dashboard** (`apps/dashboard/app/(dashboard)/knowledge/`):

- `DocumentUpload.tsx` — `ACCEPTED_EXTENSIONS` and hint text extended to
  `.pdf,.docx,.txt,.pptx,.xlsx,.csv,.html`; adds a category text input and a tag input (comma-
  separated, rendered as removable chips) that get sent as the new multipart fields.
- `DocumentList.tsx` — each row gains a category badge, tag chips, and a version badge (`v{n}`).
  Adds a "History" action opening the new `VersionHistory` panel, and an edit (pencil) action opening
  the new `DocumentMetadataEditor`. Adds category-dropdown and tag-multiselect filter controls above
  the list (populated from the distinct values present in the current list response — no new
  endpoint needed for this).
- `DocumentMetadataEditor.tsx` (new) — small inline/modal form for editing `category`/`tags` on an
  existing document via `PATCH`.
- `VersionHistory.tsx` (new) — lists all versions for a document (version number, uploader, date,
  status, size), an "Upload new version" file picker wired to the versions endpoint, and a "Restore"
  action per historical `INDEXED` row wired to the restore endpoint. Polls while any listed version
  is `PENDING`/`PROCESSING`, matching `KnowledgeBase.tsx`'s existing polling pattern.
- `KnowledgeBase.tsx` — gains handlers/state for the above (filters, metadata edit, version upload,
  restore) and passes them down; existing poll-while-processing logic extended to also cover
  in-flight version uploads it already sees via the extended list response.

**Widget / Avatar / Analytics** — no changes, same as the parent spec.

---

## Realtime Changes

This spec touches the retrieval query's `WHERE` clause, which is on the turn hot path per
`.claude/rules/realtime.md` — **requires `latency-auditor` review and a `pnpm bench:latency` run**
before merging, same rule the parent spec followed.

1. `apps/api/src/services/retrieval-service.ts`'s similarity query adds `AND kd.is_latest = true` to
   its existing join/filter on `knowledge_documents`. This is the only retrieval-path change — same
   query shape, same HNSW index usage, one additional indexed-boolean predicate. Old versions'
   chunks/embeddings stay in the table (for history/restore) but are excluded from grounding.
2. **`isLatest` only flips on ingestion *success*, never at upload time.** Rationale: if a new
   version's row became `isLatest: true` immediately on creation (while still `PENDING`/
   `PROCESSING`), retrieval would go quiet for that lineage for the entire ingestion window, even
   though the previous version's chunks are still perfectly valid and indexed — a regression versus
   today's behavior. Instead:
   - `uploadNewVersion()` creates the new row with `isLatest: false`.
   - `ingestDocument()`'s success branch (in `knowledge-service.ts`, same place that sets
     `status: "INDEXED"`) atomically, in the same transaction, sets `isLatest: true` on the new row
     and `isLatest: false` on every other row sharing its `lineageId`.
   - `ingestDocument()`'s failure branch is unchanged — the new row lands `FAILED`, `isLatest` stays
     `false`, and the previous good version keeps grounding uninterrupted.
   - The restore endpoint performs the identical atomic flip, targeting an arbitrary historical
     `INDEXED` row instead of a newly-ingested one. Both paths share one internal helper (proposed
     `setLatestVersion(orgId, lineageId, documentId)` in `knowledge-service.ts`) so the invariant
     ("exactly one `isLatest: true` row per lineage, always `INDEXED`") is enforced in one place.
3. No change to `conversation-service.ts`, the grounding system-prompt template, or the `sources`
   attribution shape — a grounded answer still cites `{ documentId, title }` of whichever row is
   currently `isLatest`, which is exactly the row the query now filters to.

---

## Files to Modify

- `prisma/schema.prisma`
- `packages/shared/src/knowledge/schema.ts` — `SUPPORTED_KNOWLEDGE_MIME_TYPES`, `knowledgeDocumentSchema`
  (`category`, `tags`, `version`, `isLatest`), new schemas for the versions-list response, the PATCH
  request body, and upload-time metadata fields
- `apps/api/src/lib/document-parsers/parser-factory.ts` — register the four new parsers
- `apps/api/src/services/knowledge-service.ts` — `uploadDocument()` (read `category`/`tags` fields),
  `toDocumentResult()` (include new fields), `listDocuments()` (highest-version-per-lineage
  reduction + category/tag filtering), `ingestDocument()` (atomic `isLatest` flip on success),
  `deleteDocument()` (promote next version on deleting the latest), new `uploadNewVersion()`,
  `listVersions()`, `restoreVersion()`, `updateDocumentMetadata()`, `setLatestVersion()`
- `apps/api/src/routes/knowledge.ts` — parse `category`/`tags` multipart fields on `POST`; parse
  `category`/`tag` query params on `GET`; add `PATCH`, `POST .../versions`, `GET .../versions`,
  `POST .../versions/:versionId/restore`
- `apps/api/src/services/retrieval-service.ts` — add `AND kd.is_latest = true`
- `apps/api/package.json` — add `xlsx`, `officeparser`
- `apps/dashboard/app/(dashboard)/knowledge/DocumentUpload.tsx`
- `apps/dashboard/app/(dashboard)/knowledge/DocumentList.tsx`
- `apps/dashboard/app/(dashboard)/knowledge/KnowledgeBase.tsx`
- `apps/dashboard/lib/api-client.ts` — `updateKnowledgeDocument`, `uploadKnowledgeDocumentVersion`,
  `listKnowledgeDocumentVersions`, `restoreKnowledgeDocumentVersion`; extend list/upload calls for
  the new filter/metadata fields

## Files to Create

- `apps/api/src/lib/document-parsers/pptx.ts` (+ `.test.ts`) — `officeparser`
- `apps/api/src/lib/document-parsers/xlsx.ts` (+ `.test.ts`) — `xlsx` (SheetJS); each sheet converted
  via `sheet_to_csv`/text conversion, concatenated with a sheet-name heading, fed into the existing
  `chunkText()` unchanged
- `apps/api/src/lib/document-parsers/csv.ts` (+ `.test.ts`) — hand-rolled RFC4180-aware parser (no
  new dependency — same "hand-roll a small parser" precedent as `chunking.ts`); first row treated as
  headers, each subsequent row emitted as one `key: value; key: value` line
- `apps/api/src/lib/document-parsers/html.ts` (+ `.test.ts`) — hand-rolled: strips `<script>`/`<style>`
  blocks entirely, converts block-level closing tags to newlines, strips remaining tags, decodes
  common HTML entities, collapses whitespace. Known, accepted limitation: not a full DOM parser, so
  severely malformed HTML may extract imperfectly — acceptable for typical exported wiki/help-center
  pages; revisit with a real parser only if this proves insufficient in practice.
- `prisma/migrations/<ts>_knowledge_document_lifecycle/migration.sql`
- `apps/dashboard/app/(dashboard)/knowledge/DocumentMetadataEditor.tsx`
- `apps/dashboard/app/(dashboard)/knowledge/VersionHistory.tsx`

---

## Dependencies

**Approved by the user for this spec** (CLAUDE.md: "Never add new dependencies without approval" —
approval obtained before this spec was written, not assumed):

1. **`xlsx`** (SheetJS) — XLSX/XLS spreadsheet parsing. No pure-JS alternative handles the OOXML ZIP
   container format safely to hand-roll.
2. **`officeparser`** — PPTX slide text extraction. Same reasoning — PPTX is OOXML, impractical to
   hand-roll.

CSV and HTML parsing are hand-rolled — no new dependency for either, per explicit direction to follow
the repo's existing hand-roll-a-small-parser precedent (`chunking.ts`, `sentence-chunker.ts`).

Legacy binary formats (`.ppt`, `.xls` — pre-OOXML, OLE compound binary) are **not** supported this
phase, matching the existing precedent of DOCX-only (no legacy `.doc`) support. Only modern
XML-container Office formats are in scope.

---

## Implementation Rules

- Follow every rule in `CLAUDE.md`
- Maintain tenant isolation using `org_id` — every new route/query scoped to
  `request.authContext!.orgId`, never a client-supplied value; version and restore endpoints must
  verify the target row (and, for restore, the version being restored) belongs to the caller's org
  before acting
- `isLatest` invariant ("exactly one `true` row per lineage, and it is always `status: INDEXED`") is
  enforced only through `setLatestVersion()` — no other code path may write `isLatest` directly
- Validate all public APIs with Zod, including the new multipart text fields and query params
- Retrieval-path changes (`retrieval-service.ts`) require `latency-auditor` review and a
  `pnpm bench:latency` run before merge — same rule as any diff touching this file
- Use strict TypeScript; never use `any`
- Prefer modifying existing code (this entire spec is additive to existing files, not parallel
  implementations)
- Run `pnpm verify`
- Do not install `xlsx`/`officeparser` casually — they're approved for this spec specifically, pin
  exact versions in `package.json` at implementation time

---

## Testing

- **Unit**: each new parser (`pptx.ts`, `xlsx.ts`, `csv.ts`, `html.ts`) against fixture files,
  including edge cases (empty sheet, CSV with quoted/escaped commas, HTML with nested
  `<script>`/`<style>`, malformed-but-common HTML); `listDocuments()`'s highest-version-per-lineage
  reduction; `setLatestVersion()`'s atomicity and invariant enforcement; `deleteDocument()`'s
  promote-next-version-on-delete-of-latest logic, including the "no remaining INDEXED version" edge
  case
- **Integration**: two-org isolation test extended to the four new routes (version upload, version
  list, restore, PATCH) — org A must never read, restore, or modify org B's documents/versions;
  restore-a-non-INDEXED-version returns `409` and does not mutate `isLatest`
- **Realtime tests**: retrieval only ever returns chunks from the `isLatest` row of a lineage, even
  when older versions have more/better-matching chunks in the vector index; a mid-ingestion new
  version does not blank out grounding for its lineage; a failed new-version upload leaves the
  previous version grounding unaffected
- **Latency Benchmarks**: `pnpm bench:latency` re-run against the modified retrieval query; confirm
  the added predicate doesn't regress the documented <100ms p95 retrieval budget
- **Manual Verification**: upload a PPTX/XLSX/CSV/HTML file each through the dashboard, confirm
  PENDING→PROCESSING→INDEXED and a grounded answer citing it; set category/tags on a document and
  confirm they persist and filter the list correctly; upload a new version of an existing document,
  confirm the avatar grounds on the new content once INDEXED and not before; restore an older
  version, confirm grounding reverts immediately; delete the active version, confirm the next
  `INDEXED` version is promoted automatically

---

## Definition of Done

- [ ] All four new formats parse correctly end-to-end (upload → index → grounded, cited answer)
- [ ] Category/tags settable, editable, and filterable in the dashboard
- [ ] Re-uploading via the versions endpoint never creates an unrelated document; grounding always
      reflects exactly one `INDEXED` version per lineage
- [ ] All tests pass
- [ ] `pnpm verify` passes
- [ ] No lint errors
- [ ] No TypeScript errors
- [ ] Documentation updated
- [ ] Latency budget maintained (retrieval <100ms p95, or documented exception) — `latency-auditor`
      sign-off on the `retrieval-service.ts` diff
- [ ] No security regressions — two-org isolation test passing for every new/modified route
- [ ] `xlsx`/`officeparser` pinned in `apps/api/package.json`, no other new dependencies introduced
