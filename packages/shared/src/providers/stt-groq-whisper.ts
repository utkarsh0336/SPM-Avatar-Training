import type { STTProvider } from "./types.js";
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

export function createGroqWhisperSTTProvider(options: GroqWhisperSTTOptions): STTProvider {
  const model = options.model ?? DEFAULT_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    name: "groq-whisper",
    async transcribe(audioBytes: Uint8Array, mimeType: string): Promise<string> {
      const form = new FormData();
      form.append(
        "file",
        new Blob([audioBytes.slice()], { type: mimeType }),
        `utterance.${extensionFor(mimeType)}`,
      );
      form.append("model", model);

      const response = await fetchImpl("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: { authorization: `Bearer ${options.apiKey}` },
        body: form,
      });
      if (!response.ok) throw await buildProviderError("groq-whisper", response);

      const json = (await response.json()) as { text?: string };
      return json.text ?? "";
    },
  };
}
