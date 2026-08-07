import { describe, expect, it } from "vitest";
import { base64ToArrayBuffer, blobToBase64 } from "./base64-audio.js";

describe("base64-audio", () => {
  it("round-trips arbitrary bytes through blobToBase64 and base64ToArrayBuffer", async () => {
    const original = new Uint8Array([0, 1, 2, 127, 128, 255, 42, 7]);
    const base64 = await blobToBase64(new Blob([original]));
    const roundTripped = new Uint8Array(base64ToArrayBuffer(base64));
    expect(roundTripped).toEqual(original);
  });

  it("handles empty input", async () => {
    const base64 = await blobToBase64(new Blob([]));
    expect(new Uint8Array(base64ToArrayBuffer(base64))).toEqual(new Uint8Array());
  });
});
