import { describe, expect, it } from "vitest";
import { KnowledgeBase } from "./KnowledgeBase";

describe("KnowledgeBase", () => {
  it("exports a component", () => {
    expect(typeof KnowledgeBase).toBe("function");
  });
});
