import type { EmbeddingProvider } from "./types.js";
import { buildProviderError } from "./provider-error.js";

export interface OpenAIEmbeddingProviderOptions {
  apiKey: string;
  model?: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_MODEL = "text-embedding-3-small";
// Matches embedding-local.ts's output width via OpenAI's own `dimensions`
// truncation parameter (Matryoshka representation learning — documented
// OpenAI behavior, not a guess), so KnowledgeChunk.embedding's vector(384)
// column needs no migration if this provider is ever swapped in. See
// .claude/specs/knowledge-management.md's Dependencies section.
const EMBEDDING_DIMENSIONS = 384;

interface OpenAIEmbeddingResponse {
  data: { embedding: number[] }[];
}

/**
 * Placeholder for the "such as ChatGPT" third-party fallback SOW §3.3
 * names — not selected by embedding-factory.ts unless EMBEDDING_PROVIDER
 * and OPENAI_API_KEY are both explicitly set. Same EmbeddingProvider shape
 * as embedding-local.ts so switching is a config change, not a redesign.
 * Server-side only, like every other provider in this boundary — never
 * reaches the browser.
 */
export function createOpenAIEmbeddingProvider(options: OpenAIEmbeddingProviderOptions): EmbeddingProvider {
  const model = options.model ?? DEFAULT_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    name: "openai",
    dimensions: EMBEDDING_DIMENSIONS,
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];
      const response = await fetchImpl("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({ model, input: texts, dimensions: EMBEDDING_DIMENSIONS }),
      });
      if (!response.ok) throw await buildProviderError("openai", response);
      const body = (await response.json()) as OpenAIEmbeddingResponse;
      return body.data.map((item) => item.embedding);
    },
  };
}
