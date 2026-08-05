import { describe, expect, it } from "vitest";
import { redact } from "./redact.js";

describe("redact", () => {
  it("is the identity function until Phase 1 redaction rules land", () => {
    expect(redact("hello")).toBe("hello");
  });
});
