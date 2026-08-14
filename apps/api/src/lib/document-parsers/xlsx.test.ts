import { describe, expect, it, vi } from "vitest";

const read = vi.fn();
const sheet_to_csv = vi.fn();

// xlsx (SheetJS) is CJS (`exports.read`, `exports.utils = {...}`), imported
// in xlsx.ts as named imports — mocked at both the named-key and
// default-export shape, same interop pattern as docx.test.ts's mammoth mock.
vi.mock("xlsx", () => {
  const mod = { read, utils: { sheet_to_csv } };
  return { ...mod, default: mod };
});

const { xlsxParser } = await import("./xlsx.js");

describe("xlsxParser", () => {
  it("reports its mime type", () => {
    expect(xlsxParser.mimeType).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });

  it("concatenates every sheet, each prefixed with a heading", async () => {
    read.mockReturnValue({
      SheetNames: ["Products", "Pricing"],
      Sheets: { Products: { a: 1 }, Pricing: { b: 2 } },
    });
    sheet_to_csv.mockReturnValueOnce("name,sku\nWidget,W1").mockReturnValueOnce("sku,price\nW1,9.99");
    const bytes = Buffer.from("fake xlsx bytes");

    const text = await xlsxParser.parse(bytes);

    expect(read).toHaveBeenCalledWith(bytes, { type: "buffer" });
    expect(text).toBe("# Products\nname,sku\nWidget,W1\n\n# Pricing\nsku,price\nW1,9.99");
  });

  it("returns an empty string body for an empty workbook", async () => {
    read.mockReturnValue({ SheetNames: [], Sheets: {} });

    const text = await xlsxParser.parse(Buffer.from("empty"));

    expect(text).toBe("");
  });
});
