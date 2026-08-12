import { describe, expect, it } from "vitest";
import KnowledgePage from "./page";

describe("knowledge page", () => {
  it("exports a page component", () => {
    expect(typeof KnowledgePage).toBe("function");
  });
});
