import { describe, expect, it } from "vitest";
import { ProgressTable } from "./ProgressTable";

describe("ProgressTable", () => {
  it("exports a component", () => {
    expect(typeof ProgressTable).toBe("function");
  });
});
