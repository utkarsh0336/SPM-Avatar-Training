import { describe, expect, it } from "vitest";
import { Button } from "./Button.js";

describe("ui", () => {
  it("exports Button", () => {
    expect(typeof Button).toBe("function");
  });
});
