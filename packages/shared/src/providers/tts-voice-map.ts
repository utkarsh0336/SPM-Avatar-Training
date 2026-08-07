// VoiceTone is declared in ../tutor/avatar-config.js (the authoritative
// source) and re-exported from there via the package barrel — imported
// here only for internal use, not re-exported, to avoid an `export *`
// ambiguity in index.ts.
import type { VoiceTone } from "../tutor/avatar-config.js";

// The approved Piper model (en_US-libritts_r-medium, CC BY 4.0) is a single
// multi-speaker model with no curated per-tone speaker mapping yet — every
// tone resolves to the same primary voice today. Real tone variation only
// exists on the msedge-tts fallback below, which has genuinely distinct
// named voices.
const PRIMARY_VOICE = "en_US-libritts_r-medium";

const FALLBACK_VOICE_BY_TONE: Record<VoiceTone, string> = {
  DEEP: "en-US-GuyNeural",
  NEUTRAL: "en-US-AriaNeural",
  WARM: "en-US-JennyNeural",
};

export function resolvePrimaryVoice(_tone: VoiceTone): string {
  return PRIMARY_VOICE;
}

export function resolveFallbackVoice(tone: VoiceTone): string {
  return FALLBACK_VOICE_BY_TONE[tone];
}
