import type { STTProvider } from "./types.js";
import { createGroqWhisperSTTProvider } from "./stt-groq-whisper.js";
import type { Language } from "../tutor/avatar-config.js";

const WHISPER_LANGUAGE_CODE: Record<Language, string> = {
  English: "en",
  Hindi: "hi",
};

/** Maps our Language enum to the ISO-639-1 code Whisper's `language` field expects. */
export function resolveWhisperLanguageCode(language: Language): string {
  return WHISPER_LANGUAGE_CODE[language];
}

/**
 * There is exactly one real server-side STTProvider (Groq Whisper) — the
 * brief's "STT fallback: browser Web Speech API" is a client-side
 * degradation path (packages/realtime-core/src/web-speech-fallback.ts), not
 * a second server-side candidate to fail over to. Returns null when no key
 * is configured; the caller (conversation-service) turns that into an
 * `stt.failed` message that triggers the client fallback.
 */
export function createSTTProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  opts?: { fetchImpl?: typeof fetch },
): STTProvider | null {
  if (!env.GROQ_API_KEY) return null;
  return createGroqWhisperSTTProvider({
    apiKey: env.GROQ_API_KEY,
    model: env.GROQ_STT_MODEL,
    fetchImpl: opts?.fetchImpl,
  });
}
