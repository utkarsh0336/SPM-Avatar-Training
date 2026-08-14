import { describe, expect, it } from "vitest";
import { VersionHistory } from "./VersionHistory";

describe("VersionHistory", () => {
  it("exports a component", () => {
    expect(typeof VersionHistory).toBe("function");
  });
});
