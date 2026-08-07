import { describe, expect, it } from "vitest";
import { createGeminiLLMProvider } from "./llm-gemini.js";
import { ProviderError } from "./provider-error.js";

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

async function collect(iterable: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const chunk of iterable) out.push(chunk);
  return out;
}

describe("createGeminiLLMProvider", () => {
  it("streams text deltas from candidates[0].content.parts[0].text", async () => {
    const fetchImpl = async () =>
      sseResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"text":" world"}]}}]}\n\n',
      ]);
    const provider = createGeminiLLMProvider({ apiKey: "k", fetchImpl });
    const chunks = await collect(
      provider.chat([{ role: "user", content: "hi" }], {
        systemPrompt: "sys",
        signal: new AbortController().signal,
      }),
    );
    expect(chunks).toEqual(["Hello", " world"]);
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
      collect(
        provider.chat([], { systemPrompt: "sys", signal: new AbortController().signal }),
      ),
    ).rejects.toMatchObject({ kind: "auth_error", provider: "gemini" } satisfies Partial<ProviderError>);
  });

  it("throws a classified ProviderError on a 429", async () => {
    const fetchImpl = async () => sseResponse([], { status: 429 });
    const provider = createGeminiLLMProvider({ apiKey: "k", fetchImpl });
    await expect(
      collect(
        provider.chat([], { systemPrompt: "sys", signal: new AbortController().signal }),
      ),
    ).rejects.toMatchObject({ kind: "rate_limited" });
  });

  it("throws a classified ProviderError on a 500", async () => {
    const fetchImpl = async () => sseResponse([], { status: 500 });
    const provider = createGeminiLLMProvider({ apiKey: "k", fetchImpl });
    await expect(
      collect(
        provider.chat([], { systemPrompt: "sys", signal: new AbortController().signal }),
      ),
    ).rejects.toMatchObject({ kind: "server_error" });
  });
});
