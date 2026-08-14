import { describe, expect, it } from "vitest";
import {
  knowledgeDocumentIdParamSchema,
  knowledgeDocumentSchema,
  knowledgeDocumentStatusSchema,
  knowledgeDocumentTagsSchema,
  knowledgeMimeTypeSchema,
  knowledgeSearchQuerySchema,
  knowledgeSourceSchema,
  listKnowledgeDocumentsQuerySchema,
  listKnowledgeDocumentsResponseSchema,
  updateKnowledgeDocumentSchema,
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

  it("accepts pptx/xlsx/csv/html", () => {
    expect(
      knowledgeMimeTypeSchema.parse(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ),
    ).toContain("presentationml");
    expect(
      knowledgeMimeTypeSchema.parse("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    ).toContain("spreadsheetml");
    expect(knowledgeMimeTypeSchema.parse("text/csv")).toBe("text/csv");
    expect(knowledgeMimeTypeSchema.parse("text/html")).toBe("text/html");
  });

  it("rejects an unsupported mime type", () => {
    expect(() => knowledgeMimeTypeSchema.parse("application/vnd.ms-powerpoint")).toThrow();
  });
});

describe("knowledgeDocumentSchema", () => {
  it("validates a full document result, including a null errorMessage and null category", () => {
    const result = knowledgeDocumentSchema.parse({
      id: "8c9a6c1a-6d1a-4c2e-9c1a-6d1a4c2e9c1a",
      title: "Leave Policy",
      originalFilename: "leave-policy.pdf",
      mimeType: "application/pdf",
      fileSizeBytes: 1024,
      status: "INDEXED",
      errorMessage: null,
      chunkCount: 12,
      category: null,
      tags: [],
      version: 1,
      isLatest: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(result.status).toBe("INDEXED");
    expect(result.errorMessage).toBeNull();
    expect(result.category).toBeNull();
    expect(result.version).toBe(1);
    expect(result.isLatest).toBe(true);
  });

  it("validates category/tags when set", () => {
    const result = knowledgeDocumentSchema.parse({
      id: "8c9a6c1a-6d1a-4c2e-9c1a-6d1a4c2e9c1a",
      title: "Leave Policy",
      originalFilename: "leave-policy.pdf",
      mimeType: "application/pdf",
      fileSizeBytes: 1024,
      status: "INDEXED",
      errorMessage: null,
      chunkCount: 12,
      category: "HR",
      tags: ["policy", "leave"],
      version: 2,
      isLatest: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(result.category).toBe("HR");
    expect(result.tags).toEqual(["policy", "leave"]);
    expect(result.version).toBe(2);
  });
});

describe("knowledgeDocumentTagsSchema", () => {
  it("accepts up to 20 tags of up to 50 chars", () => {
    expect(knowledgeDocumentTagsSchema.parse(["a".repeat(50)])).toHaveLength(1);
    expect(knowledgeDocumentTagsSchema.parse(Array.from({ length: 20 }, (_, i) => `tag-${i}`))).toHaveLength(20);
  });

  it("rejects a 21st tag", () => {
    expect(() => knowledgeDocumentTagsSchema.parse(Array.from({ length: 21 }, (_, i) => `tag-${i}`))).toThrow();
  });

  it("rejects a tag longer than 50 chars", () => {
    expect(() => knowledgeDocumentTagsSchema.parse(["a".repeat(51)])).toThrow();
  });
});

describe("updateKnowledgeDocumentSchema", () => {
  it("accepts an empty patch", () => {
    expect(updateKnowledgeDocumentSchema.parse({})).toEqual({});
  });

  it("accepts an explicit null category to clear it", () => {
    expect(updateKnowledgeDocumentSchema.parse({ category: null })).toEqual({ category: null });
  });

  it("accepts a tags-only patch", () => {
    expect(updateKnowledgeDocumentSchema.parse({ tags: ["a", "b"] })).toEqual({ tags: ["a", "b"] });
  });
});

describe("listKnowledgeDocumentsQuerySchema", () => {
  it("accepts a bare string tag", () => {
    expect(listKnowledgeDocumentsQuerySchema.parse({ tag: "hr" })).toEqual({ tag: "hr" });
  });

  it("accepts an array of tags", () => {
    expect(listKnowledgeDocumentsQuerySchema.parse({ tag: ["hr", "policy"] })).toEqual({ tag: ["hr", "policy"] });
  });

  it("accepts no filters at all", () => {
    expect(listKnowledgeDocumentsQuerySchema.parse({})).toEqual({});
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

describe("knowledgeSearchQuerySchema", () => {
  it("parses a valid query with topK", () => {
    const parsed = knowledgeSearchQuerySchema.parse({ q: "leave policy", topK: "3" });
    expect(parsed).toEqual({ q: "leave policy", topK: 3 });
  });

  it("parses with topK omitted", () => {
    const parsed = knowledgeSearchQuerySchema.parse({ q: "leave policy" });
    expect(parsed).toEqual({ q: "leave policy", topK: undefined });
  });

  it("rejects a missing q", () => {
    expect(() => knowledgeSearchQuerySchema.parse({})).toThrow();
  });

  it("rejects a blank/whitespace-only q", () => {
    expect(() => knowledgeSearchQuerySchema.parse({ q: "   " })).toThrow();
  });

  it("rejects a topK over 20", () => {
    expect(() => knowledgeSearchQuerySchema.parse({ q: "x", topK: "21" })).toThrow();
  });
});
