import type { LLMChatOptions, LLMMessage, LLMProvider } from "./types.js";
import { buildProviderError } from "./provider-error.js";
import { parseSseStream } from "./sse-parser.js";

export interface GroqLLMProviderOptions {
  apiKey: string;
  model?: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

// OpenAI-compatible surface, confirmed live earlier this session via the
// Whisper transcription endpoint on the same host/auth scheme.
const DEFAULT_MODEL = "llama-3.1-8b-instant";

interface GroqStreamChunk {
  choices?: { delta?: { content?: string } }[];
}

export function createGroqLLMProvider(options: GroqLLMProviderOptions): LLMProvider {
  const model = options.model ?? DEFAULT_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    name: "groq",
    async *chat(messages: LLMMessage[], opts: LLMChatOptions): AsyncIterable<string> {
      const response = await fetchImpl("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          model,
          stream: true,
          messages: [{ role: "system", content: opts.systemPrompt }, ...messages],
        }),
        signal: opts.signal,
      });
      if (!response.ok) throw await buildProviderError("groq", response);
      if (!response.body) throw new Error("groq response had no body");

      for await (const payload of parseSseStream(response.body)) {
        if (!payload || payload === "[DONE]") continue;
        const chunk = JSON.parse(payload) as GroqStreamChunk;
        const text = chunk.choices?.[0]?.delta?.content;
        if (text) yield text;
      }
    },
  };
}
