import { describe, expect, it } from "vitest";
import { idleClipPath, placeholderClipPath } from "./idle-clip-path.js";

describe("idleClipPath", () => {
  it("builds the per-replica idle clip path", () => {
    expect(idleClipPath("realistic-female-business_formal")).toBe(
      "/avatars/idle/realistic-female-business_formal.mp4",
    );
  });
});

describe("placeholderClipPath", () => {
  it("returns the single always-present fallback clip path", () => {
    expect(placeholderClipPath()).toBe("/avatars/idle/_placeholder.mp4");
  });
});
