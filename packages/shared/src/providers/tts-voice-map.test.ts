import { describe, expect, it } from "vitest";
import { resolveFallbackVoice, resolveHindiVoice, resolvePrimaryVoice, resolveVoiceGender } from "./tts-voice-map.js";

describe("tts-voice-map", () => {
  it("resolves distinct primary (echogarden/Piper) voices per tone for a male avatar", () => {
    expect(resolvePrimaryVoice("DEEP", "MALE")).toBe("en_US-ryan-high");
    expect(resolvePrimaryVoice("NEUTRAL", "MALE")).toBe("en_US-ryan-medium");
    expect(resolvePrimaryVoice("WARM", "MALE")).toBe("en_US-joe-medium");
    const all = new Set(["DEEP", "NEUTRAL", "WARM"].map((t) => resolvePrimaryVoice(t as never, "MALE")));
    expect(all.size).toBe(3);
  });

  it("resolves distinct primary (echogarden/Piper) voices per tone for a female avatar", () => {
    expect(resolvePrimaryVoice("DEEP", "FEMALE")).toBe("en_US-hfc_female-medium");
    expect(resolvePrimaryVoice("NEUTRAL", "FEMALE")).toBe("en_US-amy-medium");
    expect(resolvePrimaryVoice("WARM", "FEMALE")).toBe("en_US-lessac-medium");
  });

  it("never picks a female-tagged Piper voice for a male avatar's primary voice", () => {
    // Regression guard for the original bug: every gender resolved to
    // en_US-libritts_r-medium's speaker id 0 regardless of selection,
    // because echogarden's voiceGender option only filters the voice
    // catalog by name, and that model's catalog entry is tagged
    // gender: 'unknown' — which always passes the filter. A Male avatar
    // never actually got a male-sounding voice. See
    // PRIMARY_VOICE_BY_GENDER_AND_TONE's doc comment in tts-voice-map.ts.
    for (const tone of ["DEEP", "NEUTRAL", "WARM"] as const) {
      const voice = resolvePrimaryVoice(tone, "MALE");
      expect(voice).not.toBe("en_US-libritts_r-medium");
      expect(voice).not.toMatch(/amy|lessac|hfc_female/);
    }
  });

  it("resolves the neutral gender to the same primary voices as female", () => {
    for (const tone of ["DEEP", "NEUTRAL", "WARM"] as const) {
      expect(resolvePrimaryVoice(tone, "NEUTRAL")).toBe(resolvePrimaryVoice(tone, "FEMALE"));
    }
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

  it("resolves the two real GA Azure hi-IN neural voices by gender", () => {
    expect(resolveHindiVoice("MALE")).toBe("hi-IN-MadhurNeural");
    expect(resolveHindiVoice("FEMALE")).toBe("hi-IN-SwaraNeural");
    expect(resolveHindiVoice("NEUTRAL")).toBe("hi-IN-SwaraNeural");
  });
});
