import { describe, expect, it } from "vitest";
import { AvatarPreviewPanel } from "./AvatarPreviewPanel";

describe("AvatarPreviewPanel", () => {
  it("exports a component", () => {
    expect(typeof AvatarPreviewPanel).toBe("function");
  });
});
