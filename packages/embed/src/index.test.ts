import { describe, expect, it } from "vitest";
import { init } from "./index.js";

describe("embed", () => {
  it("exports init", () => {
    expect(typeof init).toBe("function");
  });
});
