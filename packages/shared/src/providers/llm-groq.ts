import type { LLMChatOptions, LLMMessage, LLMProvider, LLMStreamEvent } from "./types.js";
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

interface GroqToolCallDelta {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface GroqStreamChunk {
  choices?: {
    delta?: { content?: string; tool_calls?: GroqToolCallDelta[] };
    finish_reason?: string | null;
  }[];
}

interface GroqMessage {
  role: string;
  content: string | null;
  tool_call_id?: string;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
}

/**
 * OpenAI-compatible chat.completions message shape: an "assistant" message
 * that made tool calls carries them as tool_calls (content nulled rather
 * than omitted when it made only calls, per the OpenAI schema); a "tool"
 * message carries tool_call_id alongside its content. See
 * .claude/specs/interactive-assessment.md's Realtime Changes.
 */
function toGroqMessage(message: LLMMessage): GroqMessage {
  if (message.role === "tool") {
    return { role: "tool", content: message.content, tool_call_id: message.toolCallId };
  }
  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant",
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
      })),
    };
  }
  return { role: message.role, content: message.content };
}

export function createGroqLLMProvider(options: GroqLLMProviderOptions): LLMProvider {
  const model = options.model ?? DEFAULT_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    name: "groq",
    async *chat(messages: LLMMessage[], opts: LLMChatOptions): AsyncIterable<LLMStreamEvent> {
      const response = await fetchImpl("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          model,
          stream: true,
          messages: [{ role: "system", content: opts.systemPrompt }, ...messages.map(toGroqMessage)],
          ...(opts.tools?.length
            ? {
                tools: opts.tools.map((tool) => ({
                  type: "function",
                  function: { name: tool.name, description: tool.description, parameters: tool.parameters },
                })),
              }
            : {}),
        }),
        signal: opts.signal,
      });
      if (!response.ok) throw await buildProviderError("groq", response);
      if (!response.body) throw new Error("groq response had no body");

      // Tool-call arguments stream as string fragments across chunks, keyed
      // by `index` (stable per call within one response) — unlike Gemini,
      // which sends a call's args whole in one chunk (see llm-gemini.ts).
      // Only `id`/`function.name` are present on a call's FIRST delta;
      // later deltas for the same index carry only `function.arguments`
      // fragments to concatenate. Flushed as complete tool_call events once
      // the response's finish_reason arrives (works whether that's
      // "tool_calls" or anything else — flushing an empty accumulator is a
      // no-op).
      const pending = new Map<number, { id: string; name: string; args: string }>();
      for await (const payload of parseSseStream(response.body)) {
        if (!payload || payload === "[DONE]") continue;
        const chunk = JSON.parse(payload) as GroqStreamChunk;
        const choice = chunk.choices?.[0];
        if (!choice) continue;

        const text = choice.delta?.content;
        if (text) yield { type: "text", text };

        for (const delta of choice.delta?.tool_calls ?? []) {
          const existing = pending.get(delta.index);
          if (existing) {
            existing.args += delta.function?.arguments ?? "";
          } else {
            pending.set(delta.index, {
              id: delta.id ?? `groq-call-${delta.index}`,
              name: delta.function?.name ?? "",
              args: delta.function?.arguments ?? "",
            });
          }
        }

        if (choice.finish_reason) {
          for (const call of pending.values()) {
            yield { type: "tool_call", id: call.id, name: call.name, args: call.args ? JSON.parse(call.args) : {} };
          }
          pending.clear();
        }
      }
    },
  };
}
