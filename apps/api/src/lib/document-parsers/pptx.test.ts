import { describe, expect, it, vi } from "vitest";

const parseOfficeAsync = vi.fn();

// officeparser is CJS (`module.exports.parseOfficeAsync = ...`), imported in
// pptx.ts as a named import under Node's cjs-module-lexer interop — mocked
// at both the named-key and default-export shape so either resolution path
// used by the transpiler/loader works, same pattern as docx.test.ts's
// mammoth mock.
vi.mock("officeparser", () => {
  const mod = { parseOfficeAsync };
  return { ...mod, default: mod };
});

const { pptxParser } = await import("./pptx.js");

describe("pptxParser", () => {
  it("reports its mime type", () => {
    expect(pptxParser.mimeType).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
  });

  it("extracts text via officeparser, passing the raw buffer through", async () => {
    parseOfficeAsync.mockResolvedValue("hello from pptx");
    const bytes = Buffer.from("fake pptx bytes");

    const text = await pptxParser.parse(bytes);

    expect(text).toBe("hello from pptx");
    expect(parseOfficeAsync).toHaveBeenCalledWith(bytes);
  });
});
