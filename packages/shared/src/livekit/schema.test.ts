import { describe, expect, it } from "vitest";
import { liveKitConnectResponseSchema } from "./schema.js";

describe("liveKitConnectResponseSchema", () => {
  it("accepts a well-formed response", () => {
    const result = liveKitConnectResponseSchema.safeParse({
      livekitUrl: "wss://example.livekit.cloud",
      roomToken: "opaque-jwt",
      roomName: "ts_abc",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-URL livekitUrl", () => {
    const result = liveKitConnectResponseSchema.safeParse({
      livekitUrl: "not-a-url",
      roomToken: "opaque-jwt",
      roomName: "ts_abc",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty roomToken", () => {
    const result = liveKitConnectResponseSchema.safeParse({
      livekitUrl: "wss://example.livekit.cloud",
      roomToken: "",
      roomName: "ts_abc",
    });
    expect(result.success).toBe(false);
  });
});
