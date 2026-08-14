import { z } from "zod";

// Mirrors prisma/schema.prisma's KnowledgeDocumentStatus enum — redefined
// here rather than imported from @prisma/client so packages/shared stays
// browser-bundleable (same reasoning as ../tutor/avatar-config.ts's enums).
export const knowledgeDocumentStatusSchema = z.enum(["PENDING", "PROCESSING", "INDEXED", "FAILED"]);
export type KnowledgeDocumentStatus = z.infer<typeof knowledgeDocumentStatusSchema>;

// Formats apps/api/src/lib/document-parsers/parser-factory.ts supports.
// Legacy binary Office formats (.ppt, .xls — pre-OOXML, OLE compound
// binary) and single-URL/website-crawl ingestion remain deferred — see
// .claude/specs/knowledge-document-lifecycle.md's Overview.
export const SUPPORTED_KNOWLEDGE_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/html",
] as const;
export const knowledgeMimeTypeSchema = z.enum(SUPPORTED_KNOWLEDGE_MIME_TYPES);
export type KnowledgeMimeType = z.infer<typeof knowledgeMimeTypeSchema>;

export const MAX_KNOWLEDGE_DOCUMENT_BYTES = 25 * 1024 * 1024;

export const knowledgeDocumentSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  originalFilename: z.string(),
  mimeType: z.string(),
  fileSizeBytes: z.number().int().nonnegative(),
  status: knowledgeDocumentStatusSchema,
  errorMessage: z.string().nullable(),
  chunkCount: z.number().int().nonnegative(),
  category: z.string().nullable(),
  tags: z.array(z.string()),
  version: z.number().int().positive(),
  isLatest: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type KnowledgeDocumentResult = z.infer<typeof knowledgeDocumentSchema>;

export const listKnowledgeDocumentsResponseSchema = z.object({
  documents: z.array(knowledgeDocumentSchema),
});
export type ListKnowledgeDocumentsResponse = z.infer<typeof listKnowledgeDocumentsResponseSchema>;

export const uploadKnowledgeDocumentResponseSchema = z.object({
  id: z.string().uuid(),
  status: knowledgeDocumentStatusSchema,
});
export type UploadKnowledgeDocumentResponse = z.infer<typeof uploadKnowledgeDocumentResponseSchema>;

export const knowledgeDocumentIdParamSchema = z.object({
  documentId: z.string().uuid(),
});
export type KnowledgeDocumentIdParam = z.infer<typeof knowledgeDocumentIdParamSchema>;

// A retrieved chunk surfaced back for source attribution (SOW §3.3) — the
// avatar's transcript message carries a trimmed-down version of this (see
// ../realtime/ws-messages.ts's transcriptMessageSchema.sources).
export const knowledgeSourceSchema = z.object({
  documentId: z.string().uuid(),
  title: z.string(),
});
export type KnowledgeSource = z.infer<typeof knowledgeSourceSchema>;

// Categorization/tagging (.claude/specs/knowledge-document-lifecycle.md).
export const knowledgeDocumentCategorySchema = z.string().trim().min(1).max(100);
export const knowledgeDocumentTagSchema = z.string().trim().min(1).max(50);
export const knowledgeDocumentTagsSchema = z.array(knowledgeDocumentTagSchema).max(20);
export const knowledgeDocumentTitleSchema = z.string().trim().min(1).max(200);

// PATCH /v1/knowledge/documents/:documentId body. An explicit `null` for
// category clears it; an omitted field leaves it untouched.
export const updateKnowledgeDocumentSchema = z.object({
  category: knowledgeDocumentCategorySchema.nullable().optional(),
  tags: knowledgeDocumentTagsSchema.optional(),
});
export type UpdateKnowledgeDocumentInput = z.infer<typeof updateKnowledgeDocumentSchema>;

// GET /v1/knowledge/documents query params. `tag` is left as a
// string-or-array union here because Fastify's default querystring parser
// returns a bare string for a single occurrence and string[] for repeats —
// normalized to a single array shape by the route, not by this schema.
export const listKnowledgeDocumentsQuerySchema = z.object({
  category: z.string().min(1).max(100).optional(),
  tag: z.union([z.string(), z.array(z.string())]).optional(),
});
export type ListKnowledgeDocumentsQuery = z.infer<typeof listKnowledgeDocumentsQuerySchema>;

// Version control (.claude/specs/knowledge-document-lifecycle.md).
export const knowledgeDocumentVersionSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  title: z.string(),
  originalFilename: z.string(),
  fileSizeBytes: z.number().int().nonnegative(),
  status: knowledgeDocumentStatusSchema,
  chunkCount: z.number().int().nonnegative(),
  isLatest: z.boolean(),
  uploadedById: z.string().uuid(),
  createdAt: z.string(),
});
export type KnowledgeDocumentVersionResult = z.infer<typeof knowledgeDocumentVersionSchema>;

export const listKnowledgeDocumentVersionsResponseSchema = z.object({
  versions: z.array(knowledgeDocumentVersionSchema),
});
export type ListKnowledgeDocumentVersionsResponse = z.infer<typeof listKnowledgeDocumentVersionsResponseSchema>;

export const uploadKnowledgeDocumentVersionResponseSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  status: knowledgeDocumentStatusSchema,
});
export type UploadKnowledgeDocumentVersionResponse = z.infer<typeof uploadKnowledgeDocumentVersionResponseSchema>;

export const restoreKnowledgeDocumentVersionParamSchema = z.object({
  documentId: z.string().uuid(),
  versionId: z.string().uuid(),
});
export type RestoreKnowledgeDocumentVersionParam = z.infer<typeof restoreKnowledgeDocumentVersionParamSchema>;

// Standalone knowledge search (.claude/specs/knowledge-search-and-ingestion-queue.md).
// Not a realtime-path schema — retrieveContext() itself is unchanged; this is
// a new caller's request/response contract.
export const knowledgeSearchQuerySchema = z.object({
  q: z.string().trim().min(1),
  topK: z.coerce.number().int().positive().max(20).optional(),
});
export type KnowledgeSearchQuery = z.infer<typeof knowledgeSearchQuerySchema>;

export const knowledgeSearchResultSchema = z.object({
  documentId: z.string().uuid(),
  title: z.string(),
  content: z.string(),
  similarity: z.number(),
});
export type KnowledgeSearchResult = z.infer<typeof knowledgeSearchResultSchema>;

export const knowledgeSearchResponseSchema = z.object({
  results: z.array(knowledgeSearchResultSchema),
});
export type KnowledgeSearchResponse = z.infer<typeof knowledgeSearchResponseSchema>;
