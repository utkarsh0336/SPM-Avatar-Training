import { describe, expect, it } from "vitest";
import { TrainingAnalyticsSummary } from "./TrainingAnalyticsSummary";

describe("TrainingAnalyticsSummary", () => {
  it("exports a component", () => {
    expect(typeof TrainingAnalyticsSummary).toBe("function");
  });
});
