import { describe, expect, it } from "vitest";
import { ChecklistPanel } from "./ChecklistPanel";

describe("ChecklistPanel", () => {
  it("exports a component", () => {
    expect(typeof ChecklistPanel).toBe("function");
  });
});
