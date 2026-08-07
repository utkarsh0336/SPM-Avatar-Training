import { describe, expect, it } from "vitest";
import { createGroqLLMProvider } from "./llm-groq.js";

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

async function collect(iterable: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const chunk of iterable) out.push(chunk);
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
    const chunks = await collect(
      provider.chat([{ role: "user", content: "hi" }], {
        systemPrompt: "sys",
        signal: new AbortController().signal,
      }),
    );
    expect(chunks).toEqual(["Hi", " there"]);
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
