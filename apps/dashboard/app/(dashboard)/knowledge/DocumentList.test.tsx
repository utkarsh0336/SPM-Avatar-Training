import { describe, expect, it } from "vitest";
import { DocumentList } from "./DocumentList";

describe("DocumentList", () => {
  it("exports a component", () => {
    expect(typeof DocumentList).toBe("function");
  });
});
