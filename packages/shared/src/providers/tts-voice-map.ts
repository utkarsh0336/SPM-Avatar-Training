// VoiceTone/Gender are declared in ../tutor/avatar-config.js (the
// authoritative source) and re-exported from there via the package barrel —
// imported here only for internal use, not re-exported, to avoid an
// `export *` ambiguity in index.ts.
import type { Gender, VoiceTone } from "../tutor/avatar-config.js";

// Every en_US Piper voice below (CC BY 4.0, via echogarden's "vits" engine)
// is single-speaker and carries a real, package-declared gender tag —
// verified by reading the installed echogarden@3.0.5 package's own voice
// catalog directly (node_modules/echogarden/dist/synthesis/VitsTTS.js).
// This used to be one shared multi-speaker model
// (en_US-libritts_r-medium, 904 speakers) for every gender, with
// TTSSynthesizeOptions.voiceGender ("male"/"female") supposedly picking a
// speaker inside it — that never worked: echogarden's voiceGender option
// only filters the CATALOG (which model/voice name to load), it does not
// select a speaker id inside a multi-speaker model, and libritts_r-medium's
// catalog entry is tagged gender: 'unknown', which always passes that
// filter regardless of the requested value. So every avatar — Male or
// Female — synthesized through speaker id 0 of the same model, and the
// selected gender had no audible effect at all. Picking a genuinely
// single-speaker, correctly-tagged voice per gender (mirroring
// FALLBACK_VOICE_BY_GENDER_AND_TONE's existing gender+tone shape below)
// is what actually fixes that, with no reliance on voiceGender doing
// anything for the primary provider.
const PRIMARY_VOICE_BY_GENDER_AND_TONE: Record<Gender, Record<VoiceTone, string>> = {
  MALE: {
    DEEP: "en_US-ryan-high",
    NEUTRAL: "en_US-ryan-medium",
    WARM: "en_US-joe-medium",
  },
  FEMALE: {
    DEEP: "en_US-hfc_female-medium",
    NEUTRAL: "en_US-amy-medium",
    WARM: "en_US-lessac-medium",
  },
  // No true gender-neutral single-speaker Piper voice exists in the catalog
  // — reuses the FEMALE set, same reasoning as
  // FALLBACK_VOICE_BY_GENDER_AND_TONE's NEUTRAL row below.
  NEUTRAL: {
    DEEP: "en_US-hfc_female-medium",
    NEUTRAL: "en_US-amy-medium",
    WARM: "en_US-lessac-medium",
  },
};

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

export function resolvePrimaryVoice(tone: VoiceTone, gender: Gender): string {
  return PRIMARY_VOICE_BY_GENDER_AND_TONE[gender][tone];
}

export function resolveFallbackVoice(tone: VoiceTone, gender: Gender): string {
  return FALLBACK_VOICE_BY_GENDER_AND_TONE[gender][tone];
}

/**
 * Passed through as TTSSynthesizeOptions.voiceGender alongside
 * resolvePrimaryVoice()'s already gender-specific voice name — belt-and-
 * suspenders defense against a future catalog/voice-map change accidentally
 * reintroducing a gender mismatch, not the actual selection mechanism (see
 * PRIMARY_VOICE_BY_GENDER_AND_TONE's doc comment: echogarden's voiceGender
 * option only filters by a voice's own catalog-declared gender tag, so it
 * has no effect when, as here, the requested voice name already resolves to
 * exactly one correctly-tagged entry). NEUTRAL maps to "female" for the same
 * reason FALLBACK_VOICE_BY_GENDER_AND_TONE's NEUTRAL row reuses the female
 * voices.
 */
export function resolveVoiceGender(gender: Gender): "male" | "female" {
  return gender === "MALE" ? "male" : "female";
}

/**
 * Verified live against the installed echogarden@3.0.5's own vits (Piper)
 * voice catalog via `requestVoiceList({ engine: "vits" })`: 123 voices total,
 * zero tagged `hi`/`hi-IN` — the primary TTS provider genuinely cannot
 * synthesize Hindi. msedge-tts (Azure), by contrast, was confirmed live via
 * its own `getVoices()` to carry exactly two GA hi-IN neural voices:
 * hi-IN-MadhurNeural (Male) and hi-IN-SwaraNeural (Female) — no DEEP/NEUTRAL/
 * WARM tone variants exist for Hindi the way the English catalogs above have,
 * so tone is ignored here. See tts-factory.ts's Hindi branch, which routes
 * to msedge-tts only (never echogarden) for this reason.
 */
const HINDI_VOICE_BY_GENDER: Record<Gender, string> = {
  MALE: "hi-IN-MadhurNeural",
  FEMALE: "hi-IN-SwaraNeural",
  // Azure's Hindi catalog has no gender-neutral voice — reuses the FEMALE
  // entry, same convention as the English maps above.
  NEUTRAL: "hi-IN-SwaraNeural",
};

export function resolveHindiVoice(gender: Gender): string {
  return HINDI_VOICE_BY_GENDER[gender];
}
