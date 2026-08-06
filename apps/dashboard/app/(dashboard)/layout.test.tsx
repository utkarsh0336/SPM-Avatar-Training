import { describe, expect, it } from "vitest";
import DashboardLayout from "./layout";

describe("(dashboard) layout", () => {
  it("exports a layout component", () => {
    expect(typeof DashboardLayout).toBe("function");
  });
});
