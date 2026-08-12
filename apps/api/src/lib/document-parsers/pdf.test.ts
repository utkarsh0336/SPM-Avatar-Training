import { beforeEach, describe, expect, it, vi } from "vitest";

const getText = vi.fn();
const destroy = vi.fn();
const PDFParseMock = vi.fn().mockImplementation(() => ({ getText, destroy }));

vi.mock("pdf-parse", () => ({ PDFParse: PDFParseMock }));

const { pdfParser } = await import("./pdf.js");

describe("pdfParser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports its mime type", () => {
    expect(pdfParser.mimeType).toBe("application/pdf");
  });

  it("constructs PDFParse with the given bytes, extracts text, and destroys it", async () => {
    getText.mockResolvedValue({ text: "hello from pdf" });
    destroy.mockResolvedValue(undefined);
    const bytes = Buffer.from("fake pdf bytes");

    const text = await pdfParser.parse(bytes);

    expect(text).toBe("hello from pdf");
    expect(PDFParseMock).toHaveBeenCalledWith({ data: bytes });
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("still destroys the parser when getText throws", async () => {
    getText.mockRejectedValueOnce(new Error("corrupt pdf"));
    destroy.mockResolvedValue(undefined);

    await expect(pdfParser.parse(Buffer.from("bad"))).rejects.toThrow("corrupt pdf");
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
