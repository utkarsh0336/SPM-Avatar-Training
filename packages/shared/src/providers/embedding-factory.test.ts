import { describe, expect, it } from "vitest";
import { createEmbeddingProviderFromEnv } from "./embedding-factory.js";
import type { FeatureExtractor } from "./embedding-local.js";

const fakeExtractor: () => Promise<FeatureExtractor> = async () => async () => ({
  tolist: () => [[1, 2, 3]],
});

describe("createEmbeddingProviderFromEnv", () => {
  it("defaults to the local provider when EMBEDDING_PROVIDER is unset", () => {
    const provider = createEmbeddingProviderFromEnv({}, { loadExtractor: fakeExtractor });
    expect(provider.name).toBe("local");
  });

  it("defaults to the local provider for any unrecognized EMBEDDING_PROVIDER value", () => {
    const provider = createEmbeddingProviderFromEnv(
      { EMBEDDING_PROVIDER: "something-else" },
      { loadExtractor: fakeExtractor },
    );
    expect(provider.name).toBe("local");
  });

  it("selects openai when EMBEDDING_PROVIDER=openai and OPENAI_API_KEY is set", () => {
    const provider = createEmbeddingProviderFromEnv({
      EMBEDDING_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-test",
    });
    expect(provider.name).toBe("openai");
  });

  it("throws a clear error when EMBEDDING_PROVIDER=openai but OPENAI_API_KEY is missing", () => {
    expect(() => createEmbeddingProviderFromEnv({ EMBEDDING_PROVIDER: "openai" })).toThrow(
      /OPENAI_API_KEY is not set/,
    );
  });
});
