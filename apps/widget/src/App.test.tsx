import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("widget", () => {
  it("exports App", () => {
    expect(typeof App).toBe("function");
  });
});
