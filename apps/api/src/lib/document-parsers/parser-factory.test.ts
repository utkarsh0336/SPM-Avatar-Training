import { describe, expect, it } from "vitest";
import { getDocumentParser } from "./parser-factory.js";

describe("getDocumentParser", () => {
  it("resolves the txt parser for text/plain", () => {
    expect(getDocumentParser("text/plain")?.mimeType).toBe("text/plain");
  });

  it("resolves the pdf parser for application/pdf", () => {
    expect(getDocumentParser("application/pdf")?.mimeType).toBe("application/pdf");
  });

  it("resolves the docx parser for the docx mime type", () => {
    expect(getDocumentParser("application/vnd.openxmlformats-officedocument.wordprocessingml.document")?.mimeType).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  });

  it("returns null for an unsupported mime type", () => {
    expect(getDocumentParser("application/vnd.ms-powerpoint")).toBeNull();
  });
});
