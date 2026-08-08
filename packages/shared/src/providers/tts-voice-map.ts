// VoiceTone/Gender are declared in ../tutor/avatar-config.js (the
// authoritative source) and re-exported from there via the package barrel —
// imported here only for internal use, not re-exported, to avoid an
// `export *` ambiguity in index.ts.
import type { Gender, VoiceTone } from "../tutor/avatar-config.js";

// The approved Piper model (en_US-libritts_r-medium, CC BY 4.0) is a single
// multi-speaker model — every gender resolves to the same model name here;
// which speaker inside it actually gets used is controlled separately by
// resolveVoiceGender()'s "male"/"female" result, passed as
// TTSSynthesizeOptions.voiceGender at synthesize() call time (see
// tts-echogarden.ts). Tone still isn't curated per-speaker on this model
// (no per-tone metadata exists for its speakers), so DEEP/NEUTRAL/WARM all
// sound the same on the primary provider today — only gender varies here.
const PRIMARY_VOICE = "en_US-libritts_r-medium";

// Real en-US Azure neural voice names, fetched live via msedge-tts's own
// getVoices() (Microsoft's endpoint) and confirmed against each entry's
// returned Gender field — not guessed. Deep/Neutral/Warm is a coarse
// three-way curation choice (Azure's voice list carries no "warmth"
// attribute), but every name below is verified to exist and match the
// labeled gender. Previously this was keyed by tone only (no gender axis at
// all), so e.g. a MALE avatar on NEUTRAL/WARM tone got AriaNeural/
// JennyNeural — both female voices — regardless of the selected gender.
const FALLBACK_VOICE_BY_GENDER_AND_TONE: Record<Gender, Record<VoiceTone, string>> = {
  MALE: {
    DEEP: "en-US-GuyNeural",
    NEUTRAL: "en-US-ChristopherNeural",
    WARM: "en-US-EricNeural",
  },
  FEMALE: {
    DEEP: "en-US-MichelleNeural",
    NEUTRAL: "en-US-AriaNeural",
    WARM: "en-US-JennyNeural",
  },
  // Azure's catalog has no true gender-neutral neural voice (every entry is
  // tagged Male or Female) — reuses the FEMALE set rather than inventing an
  // unrequested third voice identity. Matches resolveVoiceGender() below,
  // so switching between the primary and fallback TTS provider never
  // audibly flips a Neutral-gender avatar's perceived gender mid-session.
  NEUTRAL: {
    DEEP: "en-US-MichelleNeural",
    NEUTRAL: "en-US-AriaNeural",
    WARM: "en-US-JennyNeural",
  },
};

export function resolvePrimaryVoice(_tone: VoiceTone): string {
  return PRIMARY_VOICE;
}

export function resolveFallbackVoice(tone: VoiceTone, gender: Gender): string {
  return FALLBACK_VOICE_BY_GENDER_AND_TONE[gender][tone];
}

/**
 * Speaker-gender hint for the primary (echogarden/VITS) provider's
 * multi-speaker model — see PRIMARY_VOICE's doc comment above. NEUTRAL maps
 * to "female" for the same reason FALLBACK_VOICE_BY_GENDER_AND_TONE's
 * NEUTRAL row reuses the female voices.
 */
export function resolveVoiceGender(gender: Gender): "male" | "female" {
  return gender === "MALE" ? "male" : "female";
}
