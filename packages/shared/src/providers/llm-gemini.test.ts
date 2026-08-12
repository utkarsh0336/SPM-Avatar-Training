import { describe, expect, it } from "vitest";
import { createGeminiLLMProvider } from "./llm-gemini.js";
import { ProviderError } from "./provider-error.js";
import type { LLMStreamEvent } from "./types.js";

function sseResponse(lines: string[], init?: { status?: number }): Response {
  const status = init?.status ?? 200;
  if (status !== 200) {
    return new Response("upstream error", { status });
  }
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

describe("createGeminiLLMProvider", () => {
  it("streams text deltas from candidates[0].content.parts[].text", async () => {
    const fetchImpl = async () =>
      sseResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"text":" world"}]}}]}\n\n',
      ]);
    const provider = createGeminiLLMProvider({ apiKey: "k", fetchImpl });
    const events = await collect(
      provider.chat([{ role: "user", content: "hi" }], {
        systemPrompt: "sys",
        signal: new AbortController().signal,
      }),
    );
    expect(events).toEqual([
      { type: "text", text: "Hello" },
      { type: "text", text: " world" },
    ]);
  });

  it("yields a tool_call event from a functionCall part", async () => {
    const fetchImpl = async () =>
      sseResponse([
        'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"start_checkpoint","id":"8f2b1a3c","args":{"objectiveId":"obj-1"}}}]}}]}\n\n',
      ]);
    const provider = createGeminiLLMProvider({ apiKey: "k", fetchImpl });
    const events = await collect(
      provider.chat([{ role: "user", content: "hi" }], {
        systemPrompt: "sys",
        signal: new AbortController().signal,
        tools: [{ name: "start_checkpoint", description: "d", parameters: { type: "object", properties: {} } }],
      }),
    );
    expect(events).toEqual([{ type: "tool_call", id: "8f2b1a3c", name: "start_checkpoint", args: { objectiveId: "obj-1" } }]);
  });

  it("sends tools as functionDeclarations when opts.tools is provided", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init;
      return sseResponse([]);
    };
    const provider = createGeminiLLMProvider({ apiKey: "k", fetchImpl });
    await collect(
      provider.chat([{ role: "user", content: "hi" }], {
        systemPrompt: "sys",
        signal: new AbortController().signal,
        tools: [{ name: "end_module", description: "d", parameters: { type: "object", properties: {} } }],
      }),
    );
    const body = JSON.parse(capturedInit?.body as string);
    expect(body.tools).toEqual([{ functionDeclarations: [{ name: "end_module", description: "d", parameters: { type: "object", properties: {} } }] }]);
  });

  it("maps a tool-result message to a role:user functionResponse turn", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init;
      return sseResponse([]);
    };
    const provider = createGeminiLLMProvider({ apiKey: "k", fetchImpl });
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
    expect(body.contents[0]).toEqual({
      role: "model",
      parts: [{ functionCall: { name: "grade_answer", id: "call-1", args: { objectiveId: "obj-1" } } }],
    });
    expect(body.contents[1]).toEqual({
      role: "user",
      parts: [{ functionResponse: { name: "grade_answer", id: "call-1", response: { result: "PASS" } } }],
    });
  });

  it("sends the api key header and system instruction", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init;
      return sseResponse([]);
    };
    const provider = createGeminiLLMProvider({ apiKey: "secret-key", fetchImpl });
    await collect(
      provider.chat([{ role: "user", content: "hi" }], {
        systemPrompt: "be a tutor",
        signal: new AbortController().signal,
      }),
    );
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("secret-key");
    const body = JSON.parse(capturedInit?.body as string);
    expect(body.systemInstruction.parts[0].text).toBe("be a tutor");
  });

  it("throws a classified ProviderError on a 401", async () => {
    const fetchImpl = async () => sseResponse([], { status: 401 });
    const provider = createGeminiLLMProvider({ apiKey: "bad", fetchImpl });
    await expect(
      collect(provider.chat([], { systemPrompt: "sys", signal: new AbortController().signal })),
    ).rejects.toMatchObject({ kind: "auth_error", provider: "gemini" } satisfies Partial<ProviderError>);
  });

  it("throws a classified ProviderError on a 429", async () => {
    const fetchImpl = async () => sseResponse([], { status: 429 });
    const provider = createGeminiLLMProvider({ apiKey: "k", fetchImpl });
    await expect(
      collect(provider.chat([], { systemPrompt: "sys", signal: new AbortController().signal })),
    ).rejects.toMatchObject({ kind: "rate_limited" });
  });

  it("throws a classified ProviderError on a 500", async () => {
    const fetchImpl = async () => sseResponse([], { status: 500 });
    const provider = createGeminiLLMProvider({ apiKey: "k", fetchImpl });
    await expect(
      collect(provider.chat([], { systemPrompt: "sys", signal: new AbortController().signal })),
    ).rejects.toMatchObject({ kind: "server_error" });
  });
});
