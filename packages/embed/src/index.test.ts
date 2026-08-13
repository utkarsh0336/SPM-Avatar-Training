import { describe, expect, it } from "vitest";
import { init, parseInboundMessage } from "./index.js";

describe("embed", () => {
  it("exports init", () => {
    expect(typeof init).toBe("function");
  });
});

describe("parseInboundMessage", () => {
  it("accepts a ready message", () => {
    expect(parseInboundMessage({ type: "avatrain:ready" })).toEqual({ type: "avatrain:ready" });
  });

  it("accepts a resize message with a positive height", () => {
    expect(parseInboundMessage({ type: "avatrain:resize", height: 620 })).toEqual({
      type: "avatrain:resize",
      height: 620,
    });
  });

  it("rejects a resize message with a non-positive height", () => {
    expect(parseInboundMessage({ type: "avatrain:resize", height: 0 })).toBeNull();
    expect(parseInboundMessage({ type: "avatrain:resize", height: -10 })).toBeNull();
  });

  it("rejects a resize message with a non-numeric height", () => {
    expect(parseInboundMessage({ type: "avatrain:resize", height: "620" })).toBeNull();
    expect(parseInboundMessage({ type: "avatrain:resize", height: Number.NaN })).toBeNull();
  });

  it("rejects an unknown message type", () => {
    expect(parseInboundMessage({ type: "something-else" })).toBeNull();
  });

  it("rejects non-object payloads without throwing", () => {
    expect(parseInboundMessage(null)).toBeNull();
    expect(parseInboundMessage(undefined)).toBeNull();
    expect(parseInboundMessage("avatrain:ready")).toBeNull();
    expect(parseInboundMessage(42)).toBeNull();
    expect(parseInboundMessage([])).toBeNull();
  });

  it("rejects a message with no type field", () => {
    expect(parseInboundMessage({ height: 500 })).toBeNull();
  });
});
