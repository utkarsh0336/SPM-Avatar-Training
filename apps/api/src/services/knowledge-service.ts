import { randomUUID } from "node:crypto";
import {
  chunkText,
  createEmbeddingProviderFromEnv,
  withOrg,
  MAX_KNOWLEDGE_DOCUMENT_BYTES,
  type KnowledgeDocumentResult,
} from "@avatrain/shared";
import type { KnowledgeDocument } from "@prisma/client";
import { badRequest, notFound } from "../lib/http-errors.js";
import { toVectorLiteral } from "../lib/pgvector.js";
import { createDocumentStorageFromEnv, type DocumentStorage } from "../lib/document-storage.js";
import { getDocumentParser } from "../lib/document-parsers/parser-factory.js";
import type { DocumentParser } from "../lib/document-parsers/types.js";

export interface UploadedFile {
  originalFilename: string;
  mimeType: string;
  bytes: Buffer;
}

export interface KnowledgeServiceDeps {
  storage?: DocumentStorage;
  createEmbeddingProvider?: typeof createEmbeddingProviderFromEnv;
  /**
   * Defaults to true. Tests set this to false so they can call
   * ingestDocument() themselves and await it deterministically, instead of
   * racing the real fire-and-forget background call against their own
   * assertions.
   */
  autoIngest?: boolean;
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
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function deriveTitleFromFilename(originalFilename: string): string {
  const withoutExtension = originalFilename.replace(/\.[^./]+$/, "");
  return withoutExtension.trim().length > 0 ? withoutExtension.trim() : originalFilename;
}

/**
 * Parse -> chunk -> embed -> persist. uploadDocument() below calls this
 * fire-and-forget (out-of-band from the upload request — see
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
    await withOrg(orgId, (tx) =>
      tx.knowledgeDocument.update({ where: { id: documentId }, data: { status: "PROCESSING" } }),
    );

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

export async function uploadDocument(
  orgId: string,
  userId: string,
  file: UploadedFile,
  deps: KnowledgeServiceDeps = {},
): Promise<{ id: string; status: KnowledgeDocumentResult["status"] }> {
  const parser = getDocumentParser(file.mimeType);
  if (!parser) throw badRequest("unsupported_mime_type", `unsupported document type: ${file.mimeType}`);
  if (file.bytes.length > MAX_KNOWLEDGE_DOCUMENT_BYTES) {
    throw badRequest("file_too_large", `document exceeds the ${MAX_KNOWLEDGE_DOCUMENT_BYTES} byte limit`);
  }

  const storage = deps.storage ?? createDocumentStorageFromEnv();
  const storageKey = await storage.save(file.bytes);
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
      },
    }),
  );

  if (deps.autoIngest ?? true) {
    void ingestDocument(orgId, document.id, file.bytes, parser, deps).catch((error: unknown) => {
      console.error("knowledge-service: ingestion crashed outside its own error handling", error);
    });
  }

  return { id: document.id, status: document.status };
}

export async function listDocuments(orgId: string): Promise<KnowledgeDocumentResult[]> {
  return withOrg(orgId, async (tx) => {
    const docs = await tx.knowledgeDocument.findMany({ where: { orgId }, orderBy: { createdAt: "desc" } });
    return docs.map(toDocumentResult);
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
  await withOrg(orgId, (tx) => tx.knowledgeDocument.delete({ where: { id: documentId } }));
  await storage.delete(doc.storageKey);
}
