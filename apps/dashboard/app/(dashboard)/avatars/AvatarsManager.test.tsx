import { describe, expect, it } from "vitest";
import { AvatarsManager } from "./AvatarsManager";

describe("AvatarsManager", () => {
  it("exports a component", () => {
    expect(typeof AvatarsManager).toBe("function");
  });
});
