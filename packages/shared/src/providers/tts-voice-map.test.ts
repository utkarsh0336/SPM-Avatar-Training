import { describe, expect, it } from "vitest";
import { resolveFallbackVoice, resolvePrimaryVoice } from "./tts-voice-map.js";

describe("tts-voice-map", () => {
  it("resolves the same primary voice for every tone (single approved Piper model)", () => {
    expect(resolvePrimaryVoice("DEEP")).toBe("en_US-libritts_r-medium");
    expect(resolvePrimaryVoice("NEUTRAL")).toBe("en_US-libritts_r-medium");
    expect(resolvePrimaryVoice("WARM")).toBe("en_US-libritts_r-medium");
  });

  it("resolves distinct fallback voices per tone", () => {
    expect(resolveFallbackVoice("DEEP")).toBe("en-US-GuyNeural");
    expect(resolveFallbackVoice("NEUTRAL")).toBe("en-US-AriaNeural");
    expect(resolveFallbackVoice("WARM")).toBe("en-US-JennyNeural");
    const all = new Set(["DEEP", "NEUTRAL", "WARM"].map((t) => resolveFallbackVoice(t as never)));
    expect(all.size).toBe(3);
  });
});
