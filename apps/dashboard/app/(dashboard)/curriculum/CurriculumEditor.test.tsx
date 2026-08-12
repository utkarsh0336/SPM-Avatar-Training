import { describe, expect, it } from "vitest";
import { CurriculumEditor } from "./CurriculumEditor";

describe("CurriculumEditor", () => {
  it("exports a component", () => {
    expect(typeof CurriculumEditor).toBe("function");
  });
});
