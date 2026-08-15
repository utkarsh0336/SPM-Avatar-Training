import { describe, expect, it } from "vitest";
import AnalyticsPage from "./page";

describe("analytics page", () => {
  it("exports a page component", () => {
    expect(typeof AnalyticsPage).toBe("function");
  });
});
