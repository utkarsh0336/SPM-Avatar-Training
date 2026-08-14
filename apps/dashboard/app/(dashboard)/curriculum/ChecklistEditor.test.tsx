import { describe, expect, it } from "vitest";
import { ChecklistEditor } from "./ChecklistEditor";

describe("ChecklistEditor", () => {
  it("exports a component", () => {
    expect(typeof ChecklistEditor).toBe("function");
  });
});
