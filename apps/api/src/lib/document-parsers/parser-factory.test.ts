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

  it("resolves the pptx parser for the pptx mime type", () => {
    const mimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    expect(getDocumentParser(mimeType)?.mimeType).toBe(mimeType);
  });

  it("resolves the xlsx parser for the xlsx mime type", () => {
    const mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    expect(getDocumentParser(mimeType)?.mimeType).toBe(mimeType);
  });

  it("resolves the csv parser for text/csv", () => {
    expect(getDocumentParser("text/csv")?.mimeType).toBe("text/csv");
  });

  it("resolves the html parser for text/html", () => {
    expect(getDocumentParser("text/html")?.mimeType).toBe("text/html");
  });

  it("returns null for an unsupported mime type", () => {
    expect(getDocumentParser("application/vnd.ms-powerpoint")).toBeNull();
  });
});
