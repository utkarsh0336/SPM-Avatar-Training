import { describe, expect, it } from "vitest";
import { createGroqLLMProvider } from "./llm-groq.js";
import type { LLMStreamEvent } from "./types.js";

function sseResponse(lines: string[], init?: { status?: number }): Response {
  const status = init?.status ?? 200;
  if (status !== 200) return new Response("upstream error", { status });
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

async function collect(iterable: AsyncIterable<LLMStreamEvent>): Promise<LLMStreamEvent[]> {
  const out: LLMStreamEvent[] = [];
  for await (const event of iterable) out.push(event);
  return out;
}

describe("createGroqLLMProvider", () => {
  it("streams text deltas from choices[0].delta.content and stops at [DONE]", async () => {
    const fetchImpl = async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" there"}}]}\n\n',
        "data: [DONE]\n\n",
      ]);
    const provider = createGroqLLMProvider({ apiKey: "k", fetchImpl });
    const events = await collect(
      provider.chat([{ role: "user", content: "hi" }], {
        systemPrompt: "sys",
        signal: new AbortController().signal,
      }),
    );
    expect(events).toEqual([
      { type: "text", text: "Hi" },
      { type: "text", text: " there" },
    ]);
  });

  it("accumulates fragmented tool_call arguments across chunks by index and flushes on finish_reason", async () => {
    const fetchImpl = async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_abc","function":{"name":"grade_answer","arguments":""}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"objectiveId\\":"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"obj-1\\"}"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
        "data: [DONE]\n\n",
      ]);
    const provider = createGroqLLMProvider({ apiKey: "k", fetchImpl });
    const events = await collect(
      provider.chat([{ role: "user", content: "hi" }], {
        systemPrompt: "sys",
        signal: new AbortController().signal,
        tools: [{ name: "grade_answer", description: "d", parameters: { type: "object", properties: {} } }],
      }),
    );
    expect(events).toEqual([{ type: "tool_call", id: "call_abc", name: "grade_answer", args: { objectiveId: "obj-1" } }]);
  });

  it("sends tools in the OpenAI-compatible shape when opts.tools is provided", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init;
      return sseResponse([]);
    };
    const provider = createGroqLLMProvider({ apiKey: "k", fetchImpl });
    await collect(
      provider.chat([{ role: "user", content: "hi" }], {
        systemPrompt: "sys",
        signal: new AbortController().signal,
        tools: [{ name: "end_module", description: "d", parameters: { type: "object", properties: {} } }],
      }),
    );
    const body = JSON.parse(capturedInit?.body as string);
    expect(body.tools).toEqual([
      { type: "function", function: { name: "end_module", description: "d", parameters: { type: "object", properties: {} } } },
    ]);
  });

  it("maps a tool-result message to role:tool with tool_call_id", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init;
      return sseResponse([]);
    };
    const provider = createGroqLLMProvider({ apiKey: "k", fetchImpl });
    await collect(
      provider.chat(
        [
          { role: "assistant", content: "", toolCalls: [{ id: "call-1", name: "grade_answer", args: { objectiveId: "obj-1" } }] },
          { role: "tool", content: "PASS", toolCallId: "call-1" },
        ],
        { systemPrompt: "sys", signal: new AbortController().signal },
      ),
    );
    const body = JSON.parse(capturedInit?.body as string);
    expect(body.messages[1]).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [{ id: "call-1", type: "function", function: { name: "grade_answer", arguments: '{"objectiveId":"obj-1"}' } }],
    });
    expect(body.messages[2]).toEqual({ role: "tool", content: "PASS", tool_call_id: "call-1" });
  });

  it("sends a bearer token and prepends the system prompt as a system message", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init;
      return sseResponse([]);
    };
    const provider = createGroqLLMProvider({ apiKey: "secret", fetchImpl });
    await collect(
      provider.chat([{ role: "user", content: "hi" }], {
        systemPrompt: "be a tutor",
        signal: new AbortController().signal,
      }),
    );
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer secret");
    const body = JSON.parse(capturedInit?.body as string);
    expect(body.messages[0]).toEqual({ role: "system", content: "be a tutor" });
    expect(body.stream).toBe(true);
  });

  it("throws a classified ProviderError on a 429", async () => {
    const fetchImpl = async () => sseResponse([], { status: 429 });
    const provider = createGroqLLMProvider({ apiKey: "k", fetchImpl });
    await expect(
      collect(provider.chat([], { systemPrompt: "sys", signal: new AbortController().signal })),
    ).rejects.toMatchObject({ kind: "rate_limited", provider: "groq" });
  });

  it("throws a classified ProviderError on a 401", async () => {
    const fetchImpl = async () => sseResponse([], { status: 401 });
    const provider = createGroqLLMProvider({ apiKey: "bad", fetchImpl });
    await expect(
      collect(provider.chat([], { systemPrompt: "sys", signal: new AbortController().signal })),
    ).rejects.toMatchObject({ kind: "auth_error" });
  });
});
