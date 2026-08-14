import { describe, expect, it } from "vitest";
import { KnowledgeSearch } from "./KnowledgeSearch";

describe("KnowledgeSearch", () => {
  it("exports a component", () => {
    expect(typeof KnowledgeSearch).toBe("function");
  });
});
