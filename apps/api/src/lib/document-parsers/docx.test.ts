import { describe, expect, it, vi } from "vitest";

const extractRawText = vi.fn();

// mammoth is CJS (`module.exports = mammoth`), imported in docx.ts as a
// default import under esModuleInterop — mocked at both the default-export
// and top-level keys so the transpiled interop shape resolves either way.
vi.mock("mammoth", () => {
  const mod = { extractRawText };
  return { ...mod, default: mod };
});

const { docxParser } = await import("./docx.js");

describe("docxParser", () => {
  it("reports its mime type", () => {
    expect(docxParser.mimeType).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  });

  it("extracts raw text via mammoth", async () => {
    extractRawText.mockResolvedValue({ value: "hello from docx", messages: [] });
    const bytes = Buffer.from("fake docx bytes");

    const text = await docxParser.parse(bytes);

    expect(text).toBe("hello from docx");
    expect(extractRawText).toHaveBeenCalledWith({ buffer: bytes });
  });
});
