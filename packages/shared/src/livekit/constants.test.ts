import { describe, expect, it } from "vitest";
import { liveKitRoomName, LIVEKIT_ROOM_PREFIX } from "./constants.js";

describe("liveKitRoomName", () => {
  it("prefixes the training session id", () => {
    expect(liveKitRoomName("sales-pitch-practice")).toBe(`${LIVEKIT_ROOM_PREFIX}sales-pitch-practice`);
  });

  it("is deterministic for the same input", () => {
    expect(liveKitRoomName("abc")).toBe(liveKitRoomName("abc"));
  });
});
