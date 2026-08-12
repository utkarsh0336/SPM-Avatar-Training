import { describe, expect, it } from "vitest";
import { ObjectiveRow } from "./ObjectiveRow";

describe("ObjectiveRow", () => {
  it("exports a component", () => {
    expect(typeof ObjectiveRow).toBe("function");
  });
});
