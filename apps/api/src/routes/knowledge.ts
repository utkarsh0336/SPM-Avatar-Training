import type { FastifyInstance } from "fastify";
import type { MultipartFields } from "@fastify/multipart";
import {
  knowledgeDocumentCategorySchema,
  knowledgeDocumentIdParamSchema,
  knowledgeDocumentTagsSchema,
  knowledgeDocumentTitleSchema,
  knowledgeSearchQuerySchema,
  knowledgeSearchResponseSchema,
  listKnowledgeDocumentsQuerySchema,
  listKnowledgeDocumentsResponseSchema,
  listKnowledgeDocumentVersionsResponseSchema,
  restoreKnowledgeDocumentVersionParamSchema,
  updateKnowledgeDocumentSchema,
  uploadKnowledgeDocumentResponseSchema,
  uploadKnowledgeDocumentVersionResponseSchema,
} from "@avatrain/shared";
import { requireRole } from "../plugins/auth.js";
import { badRequest } from "../lib/http-errors.js";
import * as knowledgeService from "../services/knowledge-service.js";
import { retrieveContext } from "../services/retrieval-service.js";

/**
 * Content curation is admin-level for now — the Role enum only has
 * OWNER/MEMBER, no finer-grained "content curator" tier. Opening this to
 * MEMBER is a one-line change later if the business wants it. orgId/userId
 * always come from request.authContext (never the request body/params) —
 * same rule as org.ts's branding route.
 */
export function registerKnowledgeRoutes(app: FastifyInstance): void {
  const gate = { preHandler: [app.authenticate, requireRole("OWNER")] };

  app.post("/v1/knowledge/documents", gate, async (request, reply) => {
    let data;
    try {
      data = await request.file();
    } catch {
      throw badRequest("file_too_large", "document exceeds the upload size limit");
    }
    if (!data) throw badRequest("missing_file", "no file part in the request");

    let bytes: Buffer;
    try {
      bytes = await data.toBuffer();
    } catch {
      throw badRequest("file_too_large", "document exceeds the upload size limit");
    }

    // @fastify/multipart only finishes parsing sibling text fields once the
    // file part's stream is fully drained — read data.fields only after
    // toBuffer() resolves above.
    const categoryRaw = readTextField(data.fields, "category");
    const category = categoryRaw !== undefined ? knowledgeDocumentCategorySchema.parse(categoryRaw) : null;

    const tagsRaw = readTextField(data.fields, "tags");
    let tags: string[] = [];
    if (tagsRaw !== undefined) {
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(tagsRaw);
      } catch {
        throw badRequest("invalid_tags", "tags must be a JSON-encoded array of strings");
      }
      const parsed = knowledgeDocumentTagsSchema.safeParse(parsedJson);
      if (!parsed.success) {
        throw badRequest("invalid_tags", "tags must be up to 20 strings, each up to 50 characters");
      }
      tags = parsed.data;
    }

    const result = await knowledgeService.uploadDocument(
      request.authContext!.orgId,
      request.authContext!.userId,
      { originalFilename: data.filename, mimeType: data.mimetype, bytes, category, tags },
    );
    reply.status(201).send(uploadKnowledgeDocumentResponseSchema.parse(result));
  });

  app.get("/v1/knowledge/documents", gate, async (request, reply) => {
    const query = listKnowledgeDocumentsQuerySchema.parse(request.query);
    const tags = query.tag === undefined ? [] : Array.isArray(query.tag) ? query.tag : [query.tag];
    const documents = await knowledgeService.listDocuments(request.authContext!.orgId, {
      category: query.category,
      tags,
    });
    reply.status(200).send(listKnowledgeDocumentsResponseSchema.parse({ documents }));
  });

  app.get("/v1/knowledge/documents/:documentId", gate, async (request, reply) => {
    const { documentId } = knowledgeDocumentIdParamSchema.parse(request.params);
    const document = await knowledgeService.getDocument(request.authContext!.orgId, documentId);
    reply.status(200).send(document);
  });

  app.patch("/v1/knowledge/documents/:documentId", gate, async (request, reply) => {
    const { documentId } = knowledgeDocumentIdParamSchema.parse(request.params);
    const input = updateKnowledgeDocumentSchema.parse(request.body);
    const document = await knowledgeService.updateDocumentMetadata(request.authContext!.orgId, documentId, input);
    reply.status(200).send(document);
  });

  app.delete("/v1/knowledge/documents/:documentId", gate, async (request, reply) => {
    const { documentId } = knowledgeDocumentIdParamSchema.parse(request.params);
    await knowledgeService.deleteDocument(request.authContext!.orgId, documentId);
    reply.status(204).send();
  });

  app.post("/v1/knowledge/documents/:documentId/versions", gate, async (request, reply) => {
    const { documentId } = knowledgeDocumentIdParamSchema.parse(request.params);

    let data;
    try {
      data = await request.file();
    } catch {
      throw badRequest("file_too_large", "document exceeds the upload size limit");
    }
    if (!data) throw badRequest("missing_file", "no file part in the request");

    let bytes: Buffer;
    try {
      bytes = await data.toBuffer();
    } catch {
      throw badRequest("file_too_large", "document exceeds the upload size limit");
    }

    const titleRaw = readTextField(data.fields, "title");
    const title = titleRaw !== undefined ? knowledgeDocumentTitleSchema.parse(titleRaw) : undefined;

    const result = await knowledgeService.uploadNewVersion(
      request.authContext!.orgId,
      request.authContext!.userId,
      documentId,
      { originalFilename: data.filename, mimeType: data.mimetype, bytes },
      { title },
    );
    reply.status(201).send(uploadKnowledgeDocumentVersionResponseSchema.parse(result));
  });

  app.get("/v1/knowledge/documents/:documentId/versions", gate, async (request, reply) => {
    const { documentId } = knowledgeDocumentIdParamSchema.parse(request.params);
    const versions = await knowledgeService.listVersions(request.authContext!.orgId, documentId);
    reply.status(200).send(listKnowledgeDocumentVersionsResponseSchema.parse({ versions }));
  });

  app.post("/v1/knowledge/documents/:documentId/versions/:versionId/restore", gate, async (request, reply) => {
    const { documentId, versionId } = restoreKnowledgeDocumentVersionParamSchema.parse(request.params);
    const document = await knowledgeService.restoreVersion(request.authContext!.orgId, documentId, versionId);
    reply.status(200).send(document);
  });

  // Standalone search (.claude/specs/knowledge-search-and-ingestion-queue.md)
  // — calls the exact same retrieveContext() the realtime turn loop uses,
  // not a modified/parallel implementation. Not on the turn hot path, so no
  // minSimilarity override and no latency budget beyond "admin tool,
  // reasonably responsive."
  app.get("/v1/knowledge/search", gate, async (request, reply) => {
    const { q, topK } = knowledgeSearchQuerySchema.parse(request.query);
    const chunks = await retrieveContext(request.authContext!.orgId, q, { topK });
    const results = chunks.map((chunk) => ({
      documentId: chunk.documentId,
      title: chunk.documentTitle,
      content: chunk.content,
      similarity: chunk.similarity,
    }));
    reply.status(200).send(knowledgeSearchResponseSchema.parse({ results }));
  });
}

/**
 * @fastify/multipart is not configured with attachFieldsToBody, so a
 * non-file field sent alongside the upload's file part comes through
 * data.fields rather than request.body — narrow to a { type: "field" }
 * entry before reading its value.
 */
function readTextField(fields: MultipartFields, name: string): string | undefined {
  const entry = fields[name];
  const field = Array.isArray(entry) ? entry[0] : entry;
  if (!field || field.type !== "field") return undefined;
  return typeof field.value === "string" ? field.value : undefined;
}
