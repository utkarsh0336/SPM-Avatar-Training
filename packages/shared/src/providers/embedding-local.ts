import { pipeline } from "@xenova/transformers";
import type { EmbeddingProvider } from "./types.js";

// Apache-2.0, 384-dim, CPU-only, no API key — the free/self-hosted default
// per .claude/specs/knowledge-management.md's Dependencies section. Must
// match KnowledgeChunk.embedding's vector(384) column.
const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const EMBEDDING_DIMENSIONS = 384;

/** Narrow slice of transformers.js's FeatureExtractionPipelineType we actually use. */
export interface FeatureExtractor {
  (texts: string[], options: { pooling: "mean"; normalize: true }): Promise<{ tolist(): number[][] }>;
}

// Loading the ONNX model is expensive (first call fetches/decodes ~90MB) —
// cached process-wide rather than per provider instance, so repeated
// createLocalEmbeddingProvider() calls (e.g. one per turn, mirroring how
// createTTS is called per sentence elsewhere) never re-trigger it. Real
// callers share this; tests inject their own loader instead of touching it.
let sharedExtractorPromise: Promise<FeatureExtractor> | null = null;

function loadSharedExtractor(): Promise<FeatureExtractor> {
  if (!sharedExtractorPromise) {
    sharedExtractorPromise = pipeline("feature-extraction", MODEL_ID) as unknown as Promise<FeatureExtractor>;
  }
  return sharedExtractorPromise;
}

/**
 * Loads (and warms) the shared model ahead of the first real request.
 * Retrieval has a <100ms p95 budget (docs/ARCHITECTURE.md §5) that a cold
 * first-call model load would blow through — call this once at process
 * boot (apps/api/src/index.ts), not on the request path.
 */
export function preloadLocalEmbeddingModel(): Promise<void> {
  return loadSharedExtractor().then(() => undefined);
}

export interface LocalEmbeddingProviderOptions {
  /** Injectable for tests; defaults to the shared, lazily-loaded real pipeline. */
  loadExtractor?: () => Promise<FeatureExtractor>;
}

export function createLocalEmbeddingProvider(options: LocalEmbeddingProviderOptions = {}): EmbeddingProvider {
  const loadExtractor = options.loadExtractor ?? loadSharedExtractor;

  return {
    name: "local",
    dimensions: EMBEDDING_DIMENSIONS,
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];
      const extractor = await loadExtractor();
      const output = await extractor(texts, { pooling: "mean", normalize: true });
      return output.tolist();
    },
  };
}
