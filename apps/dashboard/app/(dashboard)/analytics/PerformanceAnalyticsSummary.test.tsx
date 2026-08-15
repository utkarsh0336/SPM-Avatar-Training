import { describe, expect, it } from "vitest";
import { PerformanceAnalyticsSummary } from "./PerformanceAnalyticsSummary";

describe("PerformanceAnalyticsSummary", () => {
  it("exports a component", () => {
    expect(typeof PerformanceAnalyticsSummary).toBe("function");
  });
});
