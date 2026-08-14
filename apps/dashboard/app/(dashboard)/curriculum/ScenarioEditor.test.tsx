import { describe, expect, it } from "vitest";
import { ScenarioEditor } from "./ScenarioEditor";

describe("ScenarioEditor", () => {
  it("exports a component", () => {
    expect(typeof ScenarioEditor).toBe("function");
  });
});
