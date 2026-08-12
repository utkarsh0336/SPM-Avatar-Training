import { describe, expect, it } from "vitest";
import { txtParser } from "./txt.js";

describe("txtParser", () => {
  it("reports its mime type", () => {
    expect(txtParser.mimeType).toBe("text/plain");
  });

  it("decodes bytes as utf-8 text", async () => {
    const text = await txtParser.parse(Buffer.from("hello, world — café", "utf-8"));
    expect(text).toBe("hello, world — café");
  });
});
