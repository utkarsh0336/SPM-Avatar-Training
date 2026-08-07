import type { LLMChatOptions, LLMMessage, LLMProvider } from "./types.js";
import { buildProviderError } from "./provider-error.js";
import { parseSseStream } from "./sse-parser.js";

export interface GeminiLLMProviderOptions {
  apiKey: string;
  model?: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

// Verified live: POST .../v1beta/models/{model}:streamGenerateContent?alt=sse,
// x-goog-api-key header, true SSE (`data: {...}\n\n`). See the plan file's
// "Verified externally" section.
const DEFAULT_MODEL = "gemini-2.0-flash";

interface GeminiStreamChunk {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

export function createGeminiLLMProvider(options: GeminiLLMProviderOptions): LLMProvider {
  const model = options.model ?? DEFAULT_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    name: "gemini",
    async *chat(messages: LLMMessage[], opts: LLMChatOptions): AsyncIterable<string> {
      const response = await fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": options.apiKey },
          body: JSON.stringify({
            contents: messages.map((message) => ({
              role: message.role === "assistant" ? "model" : "user",
              parts: [{ text: message.content }],
            })),
            systemInstruction: { parts: [{ text: opts.systemPrompt }] },
          }),
          signal: opts.signal,
        },
      );
      if (!response.ok) throw await buildProviderError("gemini", response);
      if (!response.body) throw new Error("gemini response had no body");

      for await (const payload of parseSseStream(response.body)) {
        if (!payload) continue;
        const chunk = JSON.parse(payload) as GeminiStreamChunk;
        const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) yield text;
      }
    },
  };
}
