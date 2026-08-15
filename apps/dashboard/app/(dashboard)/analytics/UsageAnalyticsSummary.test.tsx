import { describe, expect, it } from "vitest";
import { UsageAnalyticsSummary } from "./UsageAnalyticsSummary";

describe("UsageAnalyticsSummary", () => {
  it("exports a component", () => {
    expect(typeof UsageAnalyticsSummary).toBe("function");
  });
});
