import type { TTSProvider } from "./types.js";
import { createEchogardenTTSProvider } from "./tts-echogarden.js";
import { createMsEdgeTTSProvider } from "./tts-msedge.js";
import { createFailoverTTSProvider, type TTSProviderCandidate } from "./tts-failover.js";
import { resolveFallbackVoice, resolvePrimaryVoice } from "./tts-voice-map.js";
import type { VoiceTone } from "../tutor/avatar-config.js";

export interface CreateTTSProviderFromEnvOptions {
  onResolved?: (name: string, mimeType: string) => void;
}

/**
 * TTS_PROVIDER picks which candidate is tried first (mirrors LLM_PROVIDER in
 * llm-factory.ts) — the other is always kept configured as the automatic
 * fallback, so this also doubles as a manual way to exercise the fallback
 * path without deliberately breaking the primary.
 */
export function createTTSProviderFromEnv(
  tone: VoiceTone,
  env: NodeJS.ProcessEnv = process.env,
  opts?: CreateTTSProviderFromEnvOptions,
): TTSProvider {
  const primaryFirst = env.TTS_PROVIDER !== "msedge-tts";

  const echogarden: TTSProviderCandidate = {
    name: "echogarden",
    voice: resolvePrimaryVoice(tone),
    provider: createEchogardenTTSProvider(),
  };
  const msedge: TTSProviderCandidate = {
    name: "msedge-tts",
    voice: resolveFallbackVoice(tone),
    provider: createMsEdgeTTSProvider(),
  };

  const candidates = primaryFirst ? [echogarden, msedge] : [msedge, echogarden];
  return createFailoverTTSProvider(candidates, { onResolved: opts?.onResolved });
}
