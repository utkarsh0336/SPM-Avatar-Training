import { describe, expect, it } from "vitest";
import { MembersPanel } from "./MembersPanel";

describe("MembersPanel", () => {
  it("exports a component", () => {
    expect(typeof MembersPanel).toBe("function");
  });
});
