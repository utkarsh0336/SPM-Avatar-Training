import { z } from "zod";

// Mirrors prisma/schema.prisma's KnowledgeDocumentStatus enum — redefined
// here rather than imported from @prisma/client so packages/shared stays
// browser-bundleable (same reasoning as ../tutor/avatar-config.ts's enums).
export const knowledgeDocumentStatusSchema = z.enum(["PENDING", "PROCESSING", "INDEXED", "FAILED"]);
export type KnowledgeDocumentStatus = z.infer<typeof knowledgeDocumentStatusSchema>;

// Formats apps/api/src/lib/document-parsers/parser-factory.ts supports this
// phase. The SOW's full list (PPT/XLS/CSV/HTML/URL) is deliberately
// deferred — see .claude/specs/knowledge-management.md's Files to Create.
export const SUPPORTED_KNOWLEDGE_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
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
