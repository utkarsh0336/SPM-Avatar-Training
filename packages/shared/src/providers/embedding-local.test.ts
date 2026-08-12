import { afterEach, describe, expect, it, vi } from "vitest";
import type { FeatureExtractor } from "./embedding-local.js";

function fakeExtractor(vectors: number[][]): FeatureExtractor {
  return vi.fn(async () => ({ tolist: () => vectors }));
}

describe("createLocalEmbeddingProvider", () => {
  it("reports its name and fixed dimension", async () => {
    const { createLocalEmbeddingProvider } = await import("./embedding-local.js");
    const provider = createLocalEmbeddingProvider({ loadExtractor: async () => fakeExtractor([]) });
    expect(provider.name).toBe("local");
    expect(provider.dimensions).toBe(384);
  });

  it("embeds a batch of texts via the injected extractor", async () => {
    const { createLocalEmbeddingProvider } = await import("./embedding-local.js");
    const vectors = [
      [0.1, 0.2],
      [0.3, 0.4],
    ];
    const extractor = fakeExtractor(vectors);
    const provider = createLocalEmbeddingProvider({ loadExtractor: async () => extractor });

    const result = await provider.embed(["hello", "world"]);

    expect(result).toEqual(vectors);
    expect(extractor).toHaveBeenCalledWith(["hello", "world"], { pooling: "mean", normalize: true });
  });

  it("returns an empty array without loading the extractor for an empty batch", async () => {
    const { createLocalEmbeddingProvider } = await import("./embedding-local.js");
    const loadExtractor = vi.fn(async () => fakeExtractor([]));
    const provider = createLocalEmbeddingProvider({ loadExtractor });

    const result = await provider.embed([]);

    expect(result).toEqual([]);
    expect(loadExtractor).not.toHaveBeenCalled();
  });
});

describe("the shared/default extractor (no loadExtractor injected)", () => {
  afterEach(() => {
    vi.doUnmock("@xenova/transformers");
    vi.resetModules();
  });

  it("loads the transformers.js pipeline exactly once across repeated calls", async () => {
    const pipelineMock = vi.fn(async () => fakeExtractor([[1, 2, 3]]));
    vi.doMock("@xenova/transformers", () => ({ pipeline: pipelineMock }));
    vi.resetModules();

    const { createLocalEmbeddingProvider, preloadLocalEmbeddingModel } = await import("./embedding-local.js");

    await preloadLocalEmbeddingModel();
    await createLocalEmbeddingProvider().embed(["a"]);
    await createLocalEmbeddingProvider().embed(["b"]);

    expect(pipelineMock).toHaveBeenCalledTimes(1);
    expect(pipelineMock).toHaveBeenCalledWith("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  });
});
