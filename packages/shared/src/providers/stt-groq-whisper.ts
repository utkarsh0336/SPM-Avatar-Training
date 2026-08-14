import type { STTProvider, STTTranscribeOptions } from "./types.js";
import { buildProviderError } from "./provider-error.js";

export interface GroqWhisperSTTOptions {
  apiKey: string;
  model?: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

// Verified live earlier this session: POST api.groq.com/openai/v1/audio/transcriptions,
// multipart/form-data with a `file` and `model` field, Bearer auth.
const DEFAULT_MODEL = "whisper-large-v3-turbo";

function extensionFor(mimeType: string): string {
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("mp3") || mimeType.includes("mpeg")) return "mp3";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}

// verbose_json's response shape, per Groq/OpenAI's documented
// OpenAI-Whisper-API-compatible /audio/transcriptions endpoint: the
// top-level `text` field is unchanged from the default json format, plus a
// `segments[]` array carrying per-segment confidence signals. Verified
// against Groq's published docs this session; NOT yet verified against a
// live authenticated response (no GROQ_API_KEY available in this
// environment) — do a real call before merge, per this file's own
// "verified live" convention and CLAUDE.md's "verify external APIs before
// implementation."
interface GroqVerboseTranscriptionResponse {
  text?: string;
  segments?: { avg_logprob?: number; no_speech_prob?: number }[];
}

function average(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Telemetry only — logged for later inspection, never read back into
 * control flow. A confidence-triggered retry would be a second, synchronous
 * STT call in the speech path with no filler utterance to mask it; see
 * STTTranscribeOptions.prompt's doc comment for why that's deliberately not
 * built. apps/api runs Fastify({logger:false}), so structured console.log is
 * the only record — same convention as tutor/latency-log.ts's
 * logTurnLatency.
 */
function logSttConfidence(segments: GroqVerboseTranscriptionResponse["segments"]): void {
  if (!segments || segments.length === 0) return;
  const avgLogprob = average(segments.map((s) => s.avg_logprob).filter((v): v is number => v !== undefined));
  const noSpeechProb = average(segments.map((s) => s.no_speech_prob).filter((v): v is number => v !== undefined));
  console.log(
    JSON.stringify({
      event: "stt_confidence",
      provider: "groq-whisper",
      avgLogprob,
      noSpeechProb,
      at: new Date().toISOString(),
    }),
  );
}

export function createGroqWhisperSTTProvider(options: GroqWhisperSTTOptions): STTProvider {
  const model = options.model ?? DEFAULT_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    name: "groq-whisper",
    async transcribe(audioBytes: Uint8Array, mimeType: string, opts?: STTTranscribeOptions): Promise<string> {
      const form = new FormData();
      form.append(
        "file",
        new Blob([audioBytes.slice()], { type: mimeType }),
        `utterance.${extensionFor(mimeType)}`,
      );
      form.append("model", model);
      // ISO-639-1 hint, per Groq's documented OpenAI-Whisper-API-compatible
      // /audio/transcriptions endpoint — omitted (not empty-stringed) so the
      // provider's own auto-detection still applies when no hint is given.
      if (opts?.language) form.append("language", opts.language);
      // Domain-vocabulary bias — same omit-when-absent convention as language.
      if (opts?.prompt) form.append("prompt", opts.prompt);
      // Unlocks segments[]' confidence fields (see logSttConfidence) without
      // changing the top-level `text` field this provider actually returns.
      form.append("response_format", "verbose_json");

      const response = await fetchImpl("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: { authorization: `Bearer ${options.apiKey}` },
        body: form,
      });
      if (!response.ok) throw await buildProviderError("groq-whisper", response);

      const json = (await response.json()) as GroqVerboseTranscriptionResponse;
      logSttConfidence(json.segments);
      return json.text ?? "";
    },
  };
}
