import type { FastifyInstance } from "fastify";
import {
  knowledgeDocumentIdParamSchema,
  listKnowledgeDocumentsResponseSchema,
  uploadKnowledgeDocumentResponseSchema,
} from "@avatrain/shared";
import { requireRole } from "../plugins/auth.js";
import { badRequest } from "../lib/http-errors.js";
import * as knowledgeService from "../services/knowledge-service.js";

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

    const result = await knowledgeService.uploadDocument(
      request.authContext!.orgId,
      request.authContext!.userId,
      { originalFilename: data.filename, mimeType: data.mimetype, bytes },
    );
    reply.status(201).send(uploadKnowledgeDocumentResponseSchema.parse(result));
  });

  app.get("/v1/knowledge/documents", gate, async (request, reply) => {
    const documents = await knowledgeService.listDocuments(request.authContext!.orgId);
    reply.status(200).send(listKnowledgeDocumentsResponseSchema.parse({ documents }));
  });

  app.get("/v1/knowledge/documents/:documentId", gate, async (request, reply) => {
    const { documentId } = knowledgeDocumentIdParamSchema.parse(request.params);
    const document = await knowledgeService.getDocument(request.authContext!.orgId, documentId);
    reply.status(200).send(document);
  });

  app.delete("/v1/knowledge/documents/:documentId", gate, async (request, reply) => {
    const { documentId } = knowledgeDocumentIdParamSchema.parse(request.params);
    await knowledgeService.deleteDocument(request.authContext!.orgId, documentId);
    reply.status(204).send();
  });
}
