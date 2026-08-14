import { describe, expect, it } from "vitest";
import { csvParser } from "./csv.js";

describe("csvParser", () => {
  it("reports its mime type", () => {
    expect(csvParser.mimeType).toBe("text/csv");
  });

  it("converts rows to key: value lines using the header row", async () => {
    const bytes = Buffer.from("name,sku,price\nWidget,W1,9.99\nGadget,G1,14.5\n");

    const text = await csvParser.parse(bytes);

    expect(text).toBe("name: Widget; sku: W1; price: 9.99\nname: Gadget; sku: G1; price: 14.5");
  });

  it("handles quoted fields with embedded commas", async () => {
    const bytes = Buffer.from('name,description\nWidget,"blue, small, sturdy"\n');

    const text = await csvParser.parse(bytes);

    expect(text).toBe("name: Widget; description: blue, small, sturdy");
  });

  it("handles escaped double quotes inside quoted fields", async () => {
    const bytes = Buffer.from('name,quote\nWidget,"He said ""hello"""\n');

    const text = await csvParser.parse(bytes);

    expect(text).toBe('name: Widget; quote: He said "hello"');
  });

  it("returns an empty string for a headers-only file", async () => {
    const text = await csvParser.parse(Buffer.from("name,sku,price\n"));
    expect(text).toBe("");
  });

  it("returns an empty string for empty input", async () => {
    const text = await csvParser.parse(Buffer.from(""));
    expect(text).toBe("");
  });
});
