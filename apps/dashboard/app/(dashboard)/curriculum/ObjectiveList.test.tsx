import { describe, expect, it } from "vitest";
import { ObjectiveList } from "./ObjectiveList";

describe("ObjectiveList", () => {
  it("exports a component", () => {
    expect(typeof ObjectiveList).toBe("function");
  });
});
