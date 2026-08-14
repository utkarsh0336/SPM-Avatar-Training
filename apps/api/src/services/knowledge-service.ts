import { randomUUID } from "node:crypto";
import {
  chunkText,
  createEmbeddingProviderFromEnv,
  withOrg,
  MAX_KNOWLEDGE_DOCUMENT_BYTES,
  type KnowledgeDocumentResult,
  type KnowledgeDocumentVersionResult,
} from "@avatrain/shared";
import type { KnowledgeDocument, Prisma } from "@prisma/client";
import { badRequest, conflict, notFound } from "../lib/http-errors.js";
import { toVectorLiteral } from "../lib/pgvector.js";
import { createDocumentStorageFromEnv, type DocumentStorage } from "../lib/document-storage.js";
import { getDocumentParser } from "../lib/document-parsers/parser-factory.js";
import type { DocumentParser } from "../lib/document-parsers/types.js";
import { createIngestionQueueFromEnv, type IngestionQueue } from "../lib/ingestion-queue.js";

export interface UploadedFile {
  originalFilename: string;
  mimeType: string;
  bytes: Buffer;
  category?: string | null;
  tags?: string[];
}

export interface KnowledgeServiceDeps {
  storage?: DocumentStorage;
  createEmbeddingProvider?: typeof createEmbeddingProviderFromEnv;
  ingestionQueue?: IngestionQueue;
  /**
   * Defaults to true. Tests set this to false so they can call
   * ingestDocument() themselves and await it deterministically, instead of
   * racing the real queued/worker-processed ingestion against their own
   * assertions.
   */
  autoIngest?: boolean;
}

export interface ListDocumentsFilter {
  category?: string;
  tags?: string[];
}

export interface UploadNewVersionOptions {
  title?: string;
}

export interface UpdateDocumentMetadataInput {
  category?: string | null;
  tags?: string[];
}

function toDocumentResult(doc: KnowledgeDocument): KnowledgeDocumentResult {
  return {
    id: doc.id,
    title: doc.title,
    originalFilename: doc.originalFilename,
    mimeType: doc.mimeType,
    fileSizeBytes: doc.fileSizeBytes,
    status: doc.status,
    errorMessage: doc.errorMessage,
    chunkCount: doc.chunkCount,
    category: doc.category,
    tags: doc.tags,
    version: doc.version,
    isLatest: doc.isLatest,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function deriveTitleFromFilename(originalFilename: string): string {
  const withoutExtension = originalFilename.replace(/\.[^./]+$/, "");
  return withoutExtension.trim().length > 0 ? withoutExtension.trim() : originalFilename;
}

/**
 * Shared by uploadDocument() and uploadNewVersion(): validate the incoming
 * mime type is supported, enforce the size cap, and persist the raw bytes.
 * Both callers need the exact same validate-then-store sequence before
 * creating their respective KnowledgeDocument row. Doesn't return a parser —
 * ingestion no longer runs in this process (see ingestStoredDocument()), so
 * whichever process actually processes the job resolves its own parser from
 * the persisted mimeType.
 */
async function prepareUpload(
  file: Pick<UploadedFile, "mimeType" | "bytes">,
  storage: DocumentStorage,
): Promise<{ storageKey: string }> {
  const parser = getDocumentParser(file.mimeType);
  if (!parser) throw badRequest("unsupported_mime_type", `unsupported document type: ${file.mimeType}`);
  if (file.bytes.length > MAX_KNOWLEDGE_DOCUMENT_BYTES) {
    throw badRequest("file_too_large", `document exceeds the ${MAX_KNOWLEDGE_DOCUMENT_BYTES} byte limit`);
  }
  const storageKey = await storage.save(file.bytes);
  return { storageKey };
}

/**
 * The sole writer of isLatest. Enforces "exactly one isLatest: true row per
 * lineage, and it is always status: INDEXED"
 * (.claude/specs/knowledge-document-lifecycle.md's Implementation Rules).
 * Takes an already-open transaction client rather than opening its own via
 * withOrg() so callers (ingestDocument()'s success path) compose it into
 * their own transaction — the triggering write and the isLatest flip must
 * commit atomically together.
 *
 * Also deletes every OTHER document's chunks in the lineage. This is not
 * optional cleanup — retrieval-service.ts's similarity query deliberately
 * filters on nothing but org_id, relying entirely on the invariant that
 * knowledge_chunks only ever holds a lineage's current isLatest document's
 * rows. A query-time `is_latest` filter was tried first and reverted: a
 * latency-auditor review found it defeats pgvector's HNSW ANN scan (the
 * filter lives on the joined knowledge_documents table, so Postgres can't
 * push it into the index scan) and can silently return 0 rows once a
 * meaningful fraction of an org's chunks belong to superseded versions —
 * reproduced at just 50% latest-doc ratio against a seeded 40k-chunk
 * dataset, not only pathological cases. Enforcing the invariant here, at
 * write time, keeps the retrieval query itself simple and correct by
 * construction. The consequence: a superseded document's chunks are gone,
 * not just flagged — restoreVersion()/deleteDocument()'s promotion path
 * re-ingest from the stored file rather than flipping a flag back.
 */
export async function setLatestVersion(
  tx: Prisma.TransactionClient,
  orgId: string,
  lineageId: string,
  documentId: string,
): Promise<void> {
  const target = await tx.knowledgeDocument.findFirst({ where: { id: documentId, orgId, lineageId } });
  if (!target) throw notFound("document_not_found");
  if (target.status !== "INDEXED") {
    // Defense in depth: every caller must have already checked this —
    // restoreVersion() returns a proper 409 before ever reaching here, and
    // ingestDocument() only calls this right after writing status: INDEXED
    // in the same transaction.
    throw new Error(`setLatestVersion: refusing to flip isLatest onto a non-INDEXED row (${target.status})`);
  }

  const otherDocuments = await tx.knowledgeDocument.findMany({
    where: { orgId, lineageId, id: { not: documentId } },
    select: { id: true },
  });
  const otherDocumentIds = otherDocuments.map((doc) => doc.id);

  if (otherDocumentIds.length > 0) {
    await tx.knowledgeChunk.deleteMany({ where: { orgId, documentId: { in: otherDocumentIds } } });
    await tx.knowledgeDocument.updateMany({
      where: { orgId, id: { in: otherDocumentIds } },
      data: { isLatest: false, chunkCount: 0 },
    });
  }
  await tx.knowledgeDocument.update({ where: { id: documentId }, data: { isLatest: true } });
}

/**
 * Parse -> chunk -> embed -> persist. uploadDocument()/uploadNewVersion()
 * call this fire-and-forget (out-of-band from the upload request — see
 * .claude/specs/knowledge-management.md's Realtime Changes §9, no Redis
 * queue this phase); exported separately so tests can await ingestion
 * directly instead of polling for async completion. Any failure at any
 * stage lands the document in status=FAILED with a human-readable
 * errorMessage rather than throwing into the void.
 */
export async function ingestDocument(
  orgId: string,
  documentId: string,
  fileBytes: Buffer,
  parser: DocumentParser,
  deps: KnowledgeServiceDeps,
): Promise<void> {
  const createEmbeddingProvider = deps.createEmbeddingProvider ?? createEmbeddingProviderFromEnv;

  try {
    const processing = await withOrg(orgId, (tx) =>
      tx.knowledgeDocument.update({ where: { id: documentId }, data: { status: "PROCESSING" } }),
    );
    const lineageId = processing.lineageId;

    const text = await parser.parse(fileBytes);
    const chunks = chunkText(text);

    if (chunks.length === 0) {
      await withOrg(orgId, (tx) =>
        tx.knowledgeDocument.update({
          where: { id: documentId },
          data: { status: "FAILED", errorMessage: "document contained no extractable text" },
        }),
      );
      return;
    }

    const embeddingProvider = createEmbeddingProvider();
    const vectors = await embeddingProvider.embed(chunks.map((chunk) => chunk.content));

    await withOrg(orgId, async (tx) => {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!;
        const vector = vectors[i]!;
        await tx.$executeRaw`
          INSERT INTO knowledge_chunks (id, org_id, document_id, chunk_index, content, embedding, token_count, created_at)
          VALUES (${randomUUID()}::uuid, ${orgId}::uuid, ${documentId}::uuid, ${chunk.index}, ${chunk.content}, ${toVectorLiteral(vector)}::vector, ${chunk.estimatedTokenCount}, now())
        `;
      }
      await tx.knowledgeDocument.update({
        where: { id: documentId },
        data: { status: "INDEXED", chunkCount: chunks.length, errorMessage: null },
      });
      // isLatest only flips on ingestion success, same transaction as the
      // INDEXED write — see .claude/specs/knowledge-document-lifecycle.md's
      // Realtime Changes §2. A failed re-upload never reaches this line, so
      // the previous good version keeps grounding uninterrupted.
      await setLatestVersion(tx, orgId, lineageId, documentId);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ingestion failed";
    await withOrg(orgId, (tx) =>
      tx.knowledgeDocument.update({
        where: { id: documentId },
        data: { status: "FAILED", errorMessage: message.slice(0, 500) },
      }),
    ).catch((persistError: unknown) => {
      console.error("knowledge-service: failed to persist ingestion failure status", persistError);
    });
  }
}

/**
 * Re-runs parse -> chunk -> embed -> persist for an already-uploaded
 * document, reading its bytes back from storage rather than from an
 * in-flight upload request. Originally built (as reindexAndPromote(), see
 * .claude/specs/knowledge-document-lifecycle.md) to bring a historical
 * version's chunks back after setLatestVersion() deleted them during a
 * prior supersession — restoreVersion() and deleteDocument()'s promotion
 * path both still use it for exactly that. Renamed/generalized/exported
 * here (.claude/specs/knowledge-search-and-ingestion-queue.md) to double as
 * the ingestion worker's entire job-handler body: "read a document's bytes
 * back from storage and re-run ingestion" is exactly what a queued job
 * needs to do, since a job payload carries only { orgId, documentId }, never
 * file bytes.
 */
export async function ingestStoredDocument(
  orgId: string,
  documentId: string,
  deps: KnowledgeServiceDeps = {},
): Promise<void> {
  const storage = deps.storage ?? createDocumentStorageFromEnv();
  const doc = await withOrg(orgId, (tx) => tx.knowledgeDocument.findFirst({ where: { id: documentId, orgId } }));
  if (!doc) return; // defensive — caller already confirmed existence moments ago
  const parser = getDocumentParser(doc.mimeType);
  if (!parser) return; // defensive — this mime type was already accepted once
  const bytes = await storage.read(doc.storageKey);
  await ingestDocument(orgId, documentId, bytes, parser, deps);
}

export async function uploadDocument(
  orgId: string,
  userId: string,
  file: UploadedFile,
  deps: KnowledgeServiceDeps = {},
): Promise<{ id: string; status: KnowledgeDocumentResult["status"] }> {
  const storage = deps.storage ?? createDocumentStorageFromEnv();
  const { storageKey } = await prepareUpload(file, storage);
  const title = deriveTitleFromFilename(file.originalFilename);

  const document = await withOrg(orgId, (tx) =>
    tx.knowledgeDocument.create({
      data: {
        orgId,
        uploadedById: userId,
        title,
        originalFilename: file.originalFilename,
        mimeType: file.mimeType,
        fileSizeBytes: file.bytes.length,
        storageKey,
        status: "PENDING",
        category: file.category ?? null,
        tags: file.tags ?? [],
        // lineageId/version/isLatest deliberately omitted — Prisma applies
        // their schema defaults (fresh UUID, 1, true), which is exactly "a
        // new upload is version 1 of its own new lineage."
      },
    }),
  );

  if (deps.autoIngest ?? true) {
    const ingestionQueue = deps.ingestionQueue ?? createIngestionQueueFromEnv();
    await ingestionQueue.enqueue(orgId, document.id);
  }

  return { id: document.id, status: document.status };
}

/**
 * Creates the next version in an existing document's lineage instead of an
 * unrelated document — the fix for ".claude/specs/knowledge-document-
 * lifecycle.md"'s core defect (a re-upload used to create a second,
 * unrelated row that stayed searchable alongside the stale one). Inherits
 * title/category/tags from whichever row is currently the lineage's
 * isLatest one (falling back to the highest-version row if none is — e.g.
 * every version uploaded so far has failed). The new row starts
 * isLatest: false; ingestDocument()'s success path is what promotes it.
 */
export async function uploadNewVersion(
  orgId: string,
  userId: string,
  documentId: string,
  file: UploadedFile,
  options: UploadNewVersionOptions = {},
  deps: KnowledgeServiceDeps = {},
): Promise<{ id: string; version: number; status: KnowledgeDocumentResult["status"] }> {
  const storage = deps.storage ?? createDocumentStorageFromEnv();
  const { storageKey } = await prepareUpload(file, storage);

  const created = await withOrg(orgId, async (tx) => {
    const anchor = await tx.knowledgeDocument.findFirst({ where: { id: documentId, orgId } });
    if (!anchor) throw notFound("document_not_found");

    const lineageRows = await tx.knowledgeDocument.findMany({ where: { orgId, lineageId: anchor.lineageId } });
    const inheritFrom =
      lineageRows.find((row) => row.isLatest) ??
      lineageRows.reduce((max, row) => (row.version > max.version ? row : max), anchor);
    const nextVersion = Math.max(...lineageRows.map((row) => row.version)) + 1;

    return tx.knowledgeDocument.create({
      data: {
        orgId,
        uploadedById: userId,
        title: options.title ?? inheritFrom.title,
        originalFilename: file.originalFilename,
        mimeType: file.mimeType,
        fileSizeBytes: file.bytes.length,
        storageKey,
        status: "PENDING",
        category: inheritFrom.category,
        tags: inheritFrom.tags,
        lineageId: anchor.lineageId,
        version: nextVersion,
        isLatest: false, // flips true only on ingestion success — setLatestVersion().
      },
    });
  });

  if (deps.autoIngest ?? true) {
    const ingestionQueue = deps.ingestionQueue ?? createIngestionQueueFromEnv();
    await ingestionQueue.enqueue(orgId, created.id);
  }

  return { id: created.id, version: created.version, status: created.status };
}

export async function listVersions(orgId: string, documentId: string): Promise<KnowledgeDocumentVersionResult[]> {
  return withOrg(orgId, async (tx) => {
    const anchor = await tx.knowledgeDocument.findFirst({ where: { id: documentId, orgId } });
    if (!anchor) throw notFound("document_not_found");

    const rows = await tx.knowledgeDocument.findMany({
      where: { orgId, lineageId: anchor.lineageId },
      orderBy: { version: "desc" },
    });
    return rows.map((row) => ({
      id: row.id,
      version: row.version,
      title: row.title,
      originalFilename: row.originalFilename,
      fileSizeBytes: row.fileSizeBytes,
      status: row.status,
      chunkCount: row.chunkCount,
      isLatest: row.isLatest,
      uploadedById: row.uploadedById,
      createdAt: row.createdAt.toISOString(),
    }));
  });
}

/**
 * Makes an arbitrary historical version the lineage's active grounded
 * version. Re-ingests from the target's stored file rather than flipping a
 * flag — its chunks were deleted by setLatestVersion() when it was
 * originally superseded (see that function's doc comment for why chunks
 * aren't just flagged instead of deleted). Awaited synchronously (unlike a
 * fresh upload's fire-and-forget ingestion) so the caller — an explicit,
 * single-target admin action — gets a response that reflects the actually-
 * restored state, not an in-flight one.
 */
export async function restoreVersion(
  orgId: string,
  documentId: string,
  versionId: string,
  deps: KnowledgeServiceDeps = {},
): Promise<KnowledgeDocumentResult> {
  const target = await withOrg(orgId, async (tx) => {
    const anchor = await tx.knowledgeDocument.findFirst({ where: { id: documentId, orgId } });
    if (!anchor) throw notFound("document_not_found");

    // Combined org+lineage check in one findFirst: a wrong-org or
    // wrong-lineage versionId gets the identical 404, matching the existing
    // info-leak-avoidance pattern used by getDocument()/deleteDocument().
    const row = await tx.knowledgeDocument.findFirst({
      where: { id: versionId, orgId, lineageId: anchor.lineageId },
    });
    if (!row) throw notFound("version_not_found");
    if (row.status !== "INDEXED") {
      throw conflict("version_not_restorable", "only an INDEXED version can be restored");
    }
    return row;
  });

  if (target.isLatest) return toDocumentResult(target); // already active — nothing to do

  await ingestStoredDocument(orgId, target.id, deps);
  return getDocument(orgId, target.id);
}

/**
 * Partial update: an explicit null for category clears it, an omitted
 * field leaves it untouched. Operates on whichever specific version row is
 * targeted — editing metadata on a historical version is allowed and
 * intentionally does not touch other versions in its lineage.
 */
export async function updateDocumentMetadata(
  orgId: string,
  documentId: string,
  input: UpdateDocumentMetadataInput,
): Promise<KnowledgeDocumentResult> {
  return withOrg(orgId, async (tx) => {
    const existing = await tx.knowledgeDocument.findFirst({ where: { id: documentId, orgId } });
    if (!existing) throw notFound("document_not_found");

    const updated = await tx.knowledgeDocument.update({
      where: { id: documentId },
      data: {
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
      },
    });
    return toDocumentResult(updated);
  });
}

/**
 * One row per document lineage — the highest-version row, not the
 * isLatest: true row, so an in-flight or failed re-upload attempt stays
 * visible in the list (matching today's PENDING/PROCESSING/FAILED status
 * UX) even during the window before isLatest flips. Reduction happens in
 * application code, not SQL, per .claude/specs/knowledge-document-
 * lifecycle.md's Database Changes note — org document counts are small
 * enough that this is fine. Filtering is applied after the reduction so it
 * matches the row actually displayed, not a superseded version's metadata.
 */
export async function listDocuments(
  orgId: string,
  filter: ListDocumentsFilter = {},
): Promise<KnowledgeDocumentResult[]> {
  return withOrg(orgId, async (tx) => {
    const docs = await tx.knowledgeDocument.findMany({ where: { orgId } });

    const highestPerLineage = new Map<string, KnowledgeDocument>();
    for (const doc of docs) {
      const current = highestPerLineage.get(doc.lineageId);
      if (!current || doc.version > current.version) highestPerLineage.set(doc.lineageId, doc);
    }

    const filtered = Array.from(highestPerLineage.values()).filter((doc) => {
      if (filter.category !== undefined && doc.category !== filter.category) return false;
      if (filter.tags && filter.tags.length > 0 && !filter.tags.some((tag) => doc.tags.includes(tag))) return false;
      return true;
    });

    return filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map(toDocumentResult);
  });
}

export async function getDocument(orgId: string, documentId: string): Promise<KnowledgeDocumentResult> {
  const doc = await withOrg(orgId, (tx) => tx.knowledgeDocument.findFirst({ where: { id: documentId, orgId } }));
  if (!doc) throw notFound("document_not_found");
  return toDocumentResult(doc);
}

export async function deleteDocument(
  orgId: string,
  documentId: string,
  deps: KnowledgeServiceDeps = {},
): Promise<void> {
  const storage = deps.storage ?? createDocumentStorageFromEnv();

  const doc = await withOrg(orgId, (tx) => tx.knowledgeDocument.findFirst({ where: { id: documentId, orgId } }));
  if (!doc) throw notFound("document_not_found");

  // KnowledgeChunk rows cascade via the FK's ON DELETE CASCADE — see
  // prisma/migrations/*_add_knowledge_management.
  let promoteCandidateId: string | null = null;
  await withOrg(orgId, async (tx) => {
    await tx.knowledgeDocument.delete({ where: { id: documentId } });

    if (doc.isLatest) {
      // Highest-version remaining INDEXED row in the lineage — a
      // PENDING/FAILED row can't ground. If none remain, the lineage is
      // intentionally left with no isLatest row: grounding goes quiet for
      // it, no error ("degrade, never drop").
      const [promote] = await tx.knowledgeDocument.findMany({
        where: { orgId, lineageId: doc.lineageId, status: "INDEXED" },
        orderBy: { version: "desc" },
        take: 1,
      });
      if (promote) promoteCandidateId = promote.id;
    }
  });

  await storage.delete(doc.storageKey);

  // Re-ingest rather than flip a flag: the promotion candidate's chunks
  // were already deleted when it was originally superseded — see
  // setLatestVersion()'s doc comment. Awaited (not fire-and-forget) for the
  // same determinism reason as restoreVersion(); the lineage is quietly
  // ungrounded for this brief window either way, matching the
  // "no remaining INDEXED version" case above.
  if (promoteCandidateId) await ingestStoredDocument(orgId, promoteCandidateId, deps);
}
