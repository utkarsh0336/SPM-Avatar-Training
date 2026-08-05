import { describe, expect, it } from "vitest";
import DashboardHome from "./page";

describe("dashboard", () => {
  it("exports a page component", () => {
    expect(typeof DashboardHome).toBe("function");
  });
});
