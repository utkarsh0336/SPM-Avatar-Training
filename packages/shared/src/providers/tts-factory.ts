import type { TTSProvider } from "./types.js";
import { createEchogardenTTSProvider } from "./tts-echogarden.js";
import { createMsEdgeTTSProvider } from "./tts-msedge.js";
import { createFailoverTTSProvider, type TTSProviderCandidate } from "./tts-failover.js";
import {
  resolveFallbackVoice,
  resolveHindiVoice,
  resolvePrimaryVoice,
  resolveSpanishFallbackVoice,
  resolveSpanishPrimaryVoice,
} from "./tts-voice-map.js";
import type { Gender, Language, VoiceTone } from "../tutor/avatar-config.js";

export interface CreateTTSProviderFromEnvOptions {
  onResolved?: (name: string, mimeType: string) => void;
  /**
   * Per-turn override forcing the fallback (msedge-tts) candidate to be
   * tried first, bypassing the normal TTS_PROVIDER-driven ordering — the
   * turn-latency circuit breaker's degradation lever (see
   * apps/api/src/services/turn-latency-guard.ts) for a turn already known to
   * be running behind, so it doesn't also pay for a slow primary attempt
   * before failing over. Deliberately a per-call option, not an
   * env-var/process.env mutation, since apps/api is one process serving
   * many concurrent connections/orgs — mutating process.env would leak the
   * override across all of them.
   */
  forceFallbackFirst?: boolean;
}

// Hindi has zero usable echogarden/Piper voices (see resolveHindiVoice's doc
// comment) — msedge-tts only. Spanish has a real, if imperfect, primary
// candidate (see resolveSpanishPrimaryVoice's doc comment), so it gets a
// genuine two-candidate failover below rather than reusing this shape.
const SINGLE_CANDIDATE_VOICE_RESOLVERS: Partial<Record<Language, (gender: Gender) => string>> = {
  Hindi: resolveHindiVoice,
};

/**
 * TTS_PROVIDER picks which candidate is tried first (mirrors LLM_PROVIDER in
 * llm-factory.ts) — the other is always kept configured as the automatic
 * fallback, so this also doubles as a manual way to exercise the fallback
 * path without deliberately breaking the primary. `gender` picks each
 * candidate's specific named voice — both echogarden's and msedge-tts's —
 * via resolvePrimaryVoice/resolveFallbackVoice; see tts-voice-map.ts.
 *
 * `language` defaults to English (the dual-candidate path below, also used
 * for Spanish — see resolveSpanishPrimaryVoice/resolveSpanishFallbackVoice).
 * For Hindi, echogarden/Piper's installed voice catalog has no Hindi voices
 * at all (verified live — see resolveHindiVoice's doc comment), so it is not
 * offered as a failover candidate: silently falling back to it would
 * synthesize English audio for Hindi text instead of failing with a clear
 * turn.failed(tts), which is the more honest behavior per this codebase's
 * "clear message, not silent wrong output" philosophy. Spanish's Piper
 * catalog IS usable (verified live — see resolveSpanishPrimaryVoice's doc
 * comment), so it gets the same real two-candidate failover English does.
 */
export function createTTSProviderFromEnv(
  tone: VoiceTone,
  gender: Gender,
  language: Language = "English",
  env: NodeJS.ProcessEnv = process.env,
  opts?: CreateTTSProviderFromEnvOptions,
): TTSProvider {
  const singleCandidateResolver = SINGLE_CANDIDATE_VOICE_RESOLVERS[language];
  if (singleCandidateResolver) {
    const candidates: TTSProviderCandidate[] = [
      { name: "msedge-tts", voice: singleCandidateResolver(gender), provider: createMsEdgeTTSProvider() },
    ];
    return createFailoverTTSProvider(candidates, { onResolved: opts?.onResolved });
  }

  const primaryFirst = env.TTS_PROVIDER !== "msedge-tts" && !opts?.forceFallbackFirst;

  // Spanish has real Piper voices (unlike Hindi) but no DEEP/NEUTRAL/WARM
  // tone variants (like Hindi) — resolveSpanishPrimaryVoice/
  // resolveSpanishFallbackVoice ignore `tone`, same as resolveHindiVoice.
  const echogarden: TTSProviderCandidate =
    language === "Spanish"
      ? { name: "echogarden", voice: resolveSpanishPrimaryVoice(gender), provider: createEchogardenTTSProvider() }
      : { name: "echogarden", voice: resolvePrimaryVoice(tone, gender), provider: createEchogardenTTSProvider() };
  const msedge: TTSProviderCandidate =
    language === "Spanish"
      ? { name: "msedge-tts", voice: resolveSpanishFallbackVoice(gender), provider: createMsEdgeTTSProvider() }
      : { name: "msedge-tts", voice: resolveFallbackVoice(tone, gender), provider: createMsEdgeTTSProvider() };

  const candidates = primaryFirst ? [echogarden, msedge] : [msedge, echogarden];
  return createFailoverTTSProvider(candidates, { onResolved: opts?.onResolved });
}
