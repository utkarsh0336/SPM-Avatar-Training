import { describe, expect, it } from "vitest";
import {
  knowledgeDocumentIdParamSchema,
  knowledgeDocumentSchema,
  knowledgeDocumentStatusSchema,
  knowledgeMimeTypeSchema,
  knowledgeSourceSchema,
  listKnowledgeDocumentsResponseSchema,
  uploadKnowledgeDocumentResponseSchema,
} from "./schema.js";

describe("knowledgeDocumentStatusSchema", () => {
  it("accepts all four Prisma enum values", () => {
    for (const value of ["PENDING", "PROCESSING", "INDEXED", "FAILED"]) {
      expect(knowledgeDocumentStatusSchema.parse(value)).toBe(value);
    }
  });

  it("rejects an unknown status", () => {
    expect(() => knowledgeDocumentStatusSchema.parse("DONE")).toThrow();
  });
});

describe("knowledgeMimeTypeSchema", () => {
  it("accepts pdf/docx/txt", () => {
    expect(knowledgeMimeTypeSchema.parse("application/pdf")).toBe("application/pdf");
    expect(knowledgeMimeTypeSchema.parse("text/plain")).toBe("text/plain");
  });

  it("rejects an unsupported mime type", () => {
    expect(() => knowledgeMimeTypeSchema.parse("application/vnd.ms-powerpoint")).toThrow();
  });
});

describe("knowledgeDocumentSchema", () => {
  it("validates a full document result, including a null errorMessage", () => {
    const result = knowledgeDocumentSchema.parse({
      id: "8c9a6c1a-6d1a-4c2e-9c1a-6d1a4c2e9c1a",
      title: "Leave Policy",
      originalFilename: "leave-policy.pdf",
      mimeType: "application/pdf",
      fileSizeBytes: 1024,
      status: "INDEXED",
      errorMessage: null,
      chunkCount: 12,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(result.status).toBe("INDEXED");
    expect(result.errorMessage).toBeNull();
  });
});

describe("listKnowledgeDocumentsResponseSchema / uploadKnowledgeDocumentResponseSchema", () => {
  it("validates an empty list", () => {
    expect(listKnowledgeDocumentsResponseSchema.parse({ documents: [] })).toEqual({ documents: [] });
  });

  it("validates an upload response", () => {
    const parsed = uploadKnowledgeDocumentResponseSchema.parse({
      id: "8c9a6c1a-6d1a-4c2e-9c1a-6d1a4c2e9c1a",
      status: "PENDING",
    });
    expect(parsed.status).toBe("PENDING");
  });
});

describe("knowledgeDocumentIdParamSchema", () => {
  it("rejects a non-uuid documentId", () => {
    expect(() => knowledgeDocumentIdParamSchema.parse({ documentId: "not-a-uuid" })).toThrow();
  });
});

describe("knowledgeSourceSchema", () => {
  it("validates a source attribution entry", () => {
    const parsed = knowledgeSourceSchema.parse({
      documentId: "8c9a6c1a-6d1a-4c2e-9c1a-6d1a4c2e9c1a",
      title: "Leave Policy",
    });
    expect(parsed.title).toBe("Leave Policy");
  });
});
