import type { TTSProvider } from "./types.js";
import { createEchogardenTTSProvider } from "./tts-echogarden.js";
import { createMsEdgeTTSProvider } from "./tts-msedge.js";
import { createFailoverTTSProvider, type TTSProviderCandidate } from "./tts-failover.js";
import { resolveFallbackVoice, resolveHindiVoice, resolvePrimaryVoice } from "./tts-voice-map.js";
import type { Gender, Language, VoiceTone } from "../tutor/avatar-config.js";

export interface CreateTTSProviderFromEnvOptions {
  onResolved?: (name: string, mimeType: string) => void;
}

/**
 * TTS_PROVIDER picks which candidate is tried first (mirrors LLM_PROVIDER in
 * llm-factory.ts) — the other is always kept configured as the automatic
 * fallback, so this also doubles as a manual way to exercise the fallback
 * path without deliberately breaking the primary. `gender` picks each
 * candidate's specific named voice — both echogarden's and msedge-tts's —
 * via resolvePrimaryVoice/resolveFallbackVoice; see tts-voice-map.ts.
 *
 * `language` defaults to English (the dual-candidate path above). For Hindi,
 * echogarden/Piper's installed voice catalog has no Hindi voices at all
 * (verified live — see resolveHindiVoice's doc comment), so it is not
 * offered as a failover candidate: silently falling back to it would
 * synthesize English audio for Hindi text instead of failing with a clear
 * turn.failed(tts), which is the more honest behavior per this codebase's
 * "clear message, not silent wrong output" philosophy.
 */
export function createTTSProviderFromEnv(
  tone: VoiceTone,
  gender: Gender,
  language: Language = "English",
  env: NodeJS.ProcessEnv = process.env,
  opts?: CreateTTSProviderFromEnvOptions,
): TTSProvider {
  if (language === "Hindi") {
    const candidates: TTSProviderCandidate[] = [
      { name: "msedge-tts", voice: resolveHindiVoice(gender), provider: createMsEdgeTTSProvider() },
    ];
    return createFailoverTTSProvider(candidates, { onResolved: opts?.onResolved });
  }

  const primaryFirst = env.TTS_PROVIDER !== "msedge-tts";

  const echogarden: TTSProviderCandidate = {
    name: "echogarden",
    voice: resolvePrimaryVoice(tone, gender),
    provider: createEchogardenTTSProvider(),
  };
  const msedge: TTSProviderCandidate = {
    name: "msedge-tts",
    voice: resolveFallbackVoice(tone, gender),
    provider: createMsEdgeTTSProvider(),
  };

  const candidates = primaryFirst ? [echogarden, msedge] : [msedge, echogarden];
  return createFailoverTTSProvider(candidates, { onResolved: opts?.onResolved });
}
