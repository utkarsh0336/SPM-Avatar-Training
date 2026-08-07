import { describe, expect, it } from "vitest";
import { createLLMProviderFromEnv } from "./llm-factory.js";

function sseResponse(text: string): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

/** Fake fetch that routes by hostname and records call order. */
function fakeFetch(calls: string[]) {
  return async (url: string | URL | Request) => {
    const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    if (href.includes("generativelanguage.googleapis.com")) {
      calls.push("gemini");
      return sseResponse('data: {"candidates":[{"content":{"parts":[{"text":"hi"}]}}]}\n\n');
    }
    if (href.includes("api.groq.com")) {
      calls.push("groq");
      return sseResponse('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n');
    }
    throw new Error(`unexpected fetch host: ${href}`);
  };
}

const opts = { systemPrompt: "sys", signal: new AbortController().signal };

async function drain(iterable: AsyncIterable<unknown>): Promise<void> {
  for await (const _ of iterable) void _;
}

describe("createLLMProviderFromEnv", () => {
  it("throws a clear error when no API key is configured", () => {
    expect(() => createLLMProviderFromEnv({})).toThrow(/No LLM provider configured/);
  });

  it("defaults to gemini first when LLM_PROVIDER is unset", async () => {
    const calls: string[] = [];
    const onResolved: string[] = [];
    const provider = createLLMProviderFromEnv(
      { GEMINI_API_KEY: "g", GROQ_API_KEY: "q" },
      { fetchImpl: fakeFetch(calls), onResolved: (name) => onResolved.push(name) },
    );
    await drain(provider.chat([], opts));
    expect(calls).toEqual(["gemini"]);
    expect(onResolved).toEqual(["gemini"]);
  });

  it("tries groq first when LLM_PROVIDER=groq, gemini remains configured as fallback", async () => {
    const calls: string[] = [];
    const onResolved: string[] = [];
    const provider = createLLMProviderFromEnv(
      { LLM_PROVIDER: "groq", GROQ_API_KEY: "q", GEMINI_API_KEY: "g" },
      { fetchImpl: fakeFetch(calls), onResolved: (name) => onResolved.push(name) },
    );
    await drain(provider.chat([], opts));
    expect(calls).toEqual(["groq"]);
    expect(onResolved).toEqual(["groq"]);
  });

  it("only builds candidates for providers with a configured API key", async () => {
    const calls: string[] = [];
    const provider = createLLMProviderFromEnv(
      { GROQ_API_KEY: "q" },
      { fetchImpl: fakeFetch(calls) },
    );
    await drain(provider.chat([], opts));
    expect(calls).toEqual(["groq"]);
  });
});
