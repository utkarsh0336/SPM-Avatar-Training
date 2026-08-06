import { describe, expect, it } from "vitest";
import { generateOpaqueToken, sha256Hex } from "./tokens.js";

describe("tokens", () => {
  it("generates unique tokens", () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(a).not.toBe(b);
  });

  it("generates tokens of consistent, sufficient length", () => {
    const token = generateOpaqueToken();
    // 32 random bytes, base64url-encoded (no padding).
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("hashes deterministically", () => {
    const token = generateOpaqueToken();
    expect(sha256Hex(token)).toBe(sha256Hex(token));
  });

  it("produces a 64-char lowercase hex digest", () => {
    expect(sha256Hex("anything")).toMatch(/^[0-9a-f]{64}$/);
  });
});
