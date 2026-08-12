import { describe, expect, it } from "vitest";
import { createOpenAIEmbeddingProvider } from "./embedding-openai.js";
import { ProviderError } from "./provider-error.js";

function jsonResponse(body: unknown, init?: { status?: number }): Response {
  return new Response(JSON.stringify(body), { status: init?.status ?? 200 });
}

describe("createOpenAIEmbeddingProvider", () => {
  it("reports its name and the 384-dim truncation width", () => {
    const provider = createOpenAIEmbeddingProvider({ apiKey: "k" });
    expect(provider.name).toBe("openai");
    expect(provider.dimensions).toBe(384);
  });

  it("returns one embedding vector per input text, in order", async () => {
    const fetchImpl = async () =>
      jsonResponse({ data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }] });
    const provider = createOpenAIEmbeddingProvider({ apiKey: "k", fetchImpl });

    const result = await provider.embed(["hello", "world"]);

    expect(result).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
  });

  it("sends the bearer auth header, model, input, and dimensions", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init;
      return jsonResponse({ data: [] });
    };
    const provider = createOpenAIEmbeddingProvider({ apiKey: "secret-key", fetchImpl });
    await provider.embed(["hi"]);

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer secret-key");
    const body = JSON.parse(capturedInit?.body as string);
    expect(body).toEqual({ model: "text-embedding-3-small", input: ["hi"], dimensions: 384 });
  });

  it("returns an empty array without calling fetch for an empty batch", async () => {
    let called = false;
    const fetchImpl = async () => {
      called = true;
      return jsonResponse({ data: [] });
    };
    const provider = createOpenAIEmbeddingProvider({ apiKey: "k", fetchImpl });

    const result = await provider.embed([]);

    expect(result).toEqual([]);
    expect(called).toBe(false);
  });

  it("throws a classified ProviderError on a 401", async () => {
    const fetchImpl = async () => jsonResponse({}, { status: 401 });
    const provider = createOpenAIEmbeddingProvider({ apiKey: "bad", fetchImpl });
    await expect(provider.embed(["hi"])).rejects.toMatchObject({
      kind: "auth_error",
      provider: "openai",
    } satisfies Partial<ProviderError>);
  });

  it("throws a classified ProviderError on a 429", async () => {
    const fetchImpl = async () => jsonResponse({}, { status: 429 });
    const provider = createOpenAIEmbeddingProvider({ apiKey: "k", fetchImpl });
    await expect(provider.embed(["hi"])).rejects.toMatchObject({ kind: "rate_limited" });
  });
});
