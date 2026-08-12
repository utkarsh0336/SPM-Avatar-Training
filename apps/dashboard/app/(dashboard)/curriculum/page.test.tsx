import { describe, expect, it } from "vitest";
import CurriculumPage from "./page";

describe("curriculum page", () => {
  it("exports a page component", () => {
    expect(typeof CurriculumPage).toBe("function");
  });
});
