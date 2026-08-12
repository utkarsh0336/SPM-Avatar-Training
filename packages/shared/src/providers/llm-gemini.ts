import type { LLMChatOptions, LLMMessage, LLMProvider, LLMStreamEvent } from "./types.js";
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

interface GeminiFunctionCall {
  name: string;
  id?: string;
  args?: unknown;
}

interface GeminiFunctionResponse {
  name: string;
  id?: string;
  response: unknown;
}

interface GeminiPart {
  text?: string;
  functionCall?: GeminiFunctionCall;
  functionResponse?: GeminiFunctionResponse;
}

interface GeminiStreamChunk {
  candidates?: { content?: { parts?: GeminiPart[] } }[];
}

/**
 * Gemini's function-calling wire format (verified against
 * ai.google.dev/gemini-api/docs/generate-content/function-calling, since
 * getting this wrong is easy to do silently — see .claude/rules and
 * CLAUDE.md's "verify external APIs before implementation"):
 * - The model's own tool-call turn is `role: "model"`, with one
 *   `functionCall: {name, id, args}` part per call it made (verified: the
 *   response DOES include a real per-call `id`, unlike the JS SDK's
 *   higher-level docs, which don't surface one — this is the raw REST
 *   endpoint this file actually calls).
 * - The turn carrying a tool's result back is `role: "user"` (NOT
 *   "function" — that was the wrong guess before checking), with a
 *   `functionResponse: {name, id, response}` part whose `id` echoes the
 *   original functionCall's `id`.
 * toolMessageNames resolves a "tool"-role LLMMessage's toolCallId back to
 * its function name (functionResponse needs both) by scanning every
 * preceding "assistant" message's toolCalls — safe because
 * conversation-service.ts's tool loop only ever appends a
 * (assistant-with-toolCalls, tool-result) pair together, so every
 * toolCallId a "tool" message carries was declared by an earlier assistant
 * message in the same array.
 */
function buildToolCallNameIndex(messages: LLMMessage[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const message of messages) {
    for (const call of message.toolCalls ?? []) names.set(call.id, call.name);
  }
  return names;
}

function toGeminiContent(message: LLMMessage, toolCallNames: Map<string, string>): { role: string; parts: GeminiPart[] } {
  if (message.role === "tool") {
    const name = message.toolCallId ? toolCallNames.get(message.toolCallId) : undefined;
    return {
      role: "user",
      parts: [{ functionResponse: { name: name ?? "unknown", id: message.toolCallId, response: { result: message.content } } }],
    };
  }
  if (message.role === "assistant" && message.toolCalls?.length) {
    const parts: GeminiPart[] = message.content ? [{ text: message.content }] : [];
    for (const call of message.toolCalls) parts.push({ functionCall: { name: call.name, id: call.id, args: call.args } });
    return { role: "model", parts };
  }
  return {
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  };
}

export function createGeminiLLMProvider(options: GeminiLLMProviderOptions): LLMProvider {
  const model = options.model ?? DEFAULT_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    name: "gemini",
    async *chat(messages: LLMMessage[], opts: LLMChatOptions): AsyncIterable<LLMStreamEvent> {
      const toolCallNames = buildToolCallNameIndex(messages);
      const response = await fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": options.apiKey },
          body: JSON.stringify({
            contents: messages.map((message) => toGeminiContent(message, toolCallNames)),
            systemInstruction: { parts: [{ text: opts.systemPrompt }] },
            ...(opts.tools?.length
              ? {
                  tools: [
                    {
                      functionDeclarations: opts.tools.map((tool) => ({
                        name: tool.name,
                        description: tool.description,
                        parameters: tool.parameters,
                      })),
                    },
                  ],
                }
              : {}),
          }),
          signal: opts.signal,
        },
      );
      if (!response.ok) throw await buildProviderError("gemini", response);
      if (!response.body) throw new Error("gemini response had no body");

      // Gemini's documented example shows a functionCall arriving with its
      // full `args` already assembled in one chunk — unlike Groq/OpenAI, it
      // does not fragment a call's arguments across multiple stream chunks,
      // so no cross-chunk accumulation is needed here.
      let callCounter = 0;
      for await (const payload of parseSseStream(response.body)) {
        if (!payload) continue;
        const chunk = JSON.parse(payload) as GeminiStreamChunk;
        for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
          if (part.text) yield { type: "text", text: part.text };
          if (part.functionCall) {
            callCounter += 1;
            yield {
              type: "tool_call",
              id: part.functionCall.id ?? `gemini-call-${callCounter}`,
              name: part.functionCall.name,
              args: part.functionCall.args,
            };
          }
        }
      }
    },
  };
}
