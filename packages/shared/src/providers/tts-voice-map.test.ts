import { describe, expect, it } from "vitest";
import { resolveFallbackVoice, resolvePrimaryVoice, resolveVoiceGender } from "./tts-voice-map.js";

describe("tts-voice-map", () => {
  it("resolves the same primary voice for every tone (single approved Piper model)", () => {
    expect(resolvePrimaryVoice("DEEP")).toBe("en_US-libritts_r-medium");
    expect(resolvePrimaryVoice("NEUTRAL")).toBe("en_US-libritts_r-medium");
    expect(resolvePrimaryVoice("WARM")).toBe("en_US-libritts_r-medium");
  });

  it("resolves distinct fallback voices per tone for a male avatar", () => {
    expect(resolveFallbackVoice("DEEP", "MALE")).toBe("en-US-GuyNeural");
    expect(resolveFallbackVoice("NEUTRAL", "MALE")).toBe("en-US-ChristopherNeural");
    expect(resolveFallbackVoice("WARM", "MALE")).toBe("en-US-EricNeural");
    const all = new Set(["DEEP", "NEUTRAL", "WARM"].map((t) => resolveFallbackVoice(t as never, "MALE")));
    expect(all.size).toBe(3);
  });

  it("resolves distinct fallback voices per tone for a female avatar", () => {
    expect(resolveFallbackVoice("DEEP", "FEMALE")).toBe("en-US-MichelleNeural");
    expect(resolveFallbackVoice("NEUTRAL", "FEMALE")).toBe("en-US-AriaNeural");
    expect(resolveFallbackVoice("WARM", "FEMALE")).toBe("en-US-JennyNeural");
  });

  it("never picks a male voice for a male avatar's fallback voice by way of a female-only entry", () => {
    // Regression guard for the original bug: a male avatar previously got
    // AriaNeural/JennyNeural (both female) on NEUTRAL/WARM tone because the
    // voice map only keyed off tone, never gender.
    for (const tone of ["DEEP", "NEUTRAL", "WARM"] as const) {
      expect(resolveFallbackVoice(tone, "MALE")).not.toMatch(/Aria|Jenny/);
    }
  });

  it("resolves the neutral gender to the same voices as female, on both providers", () => {
    for (const tone of ["DEEP", "NEUTRAL", "WARM"] as const) {
      expect(resolveFallbackVoice(tone, "NEUTRAL")).toBe(resolveFallbackVoice(tone, "FEMALE"));
    }
    expect(resolveVoiceGender("NEUTRAL")).toBe(resolveVoiceGender("FEMALE"));
  });

  it("resolves the primary provider's speaker-gender hint from avatar gender", () => {
    expect(resolveVoiceGender("MALE")).toBe("male");
    expect(resolveVoiceGender("FEMALE")).toBe("female");
    expect(resolveVoiceGender("NEUTRAL")).toBe("female");
  });
});
