import type { EmbeddingProvider } from "./types.js";
import { createLocalEmbeddingProvider, type LocalEmbeddingProviderOptions } from "./embedding-local.js";
import { createOpenAIEmbeddingProvider } from "./embedding-openai.js";

export type EmbeddingProviderName = "local" | "openai";

export interface CreateEmbeddingProviderFromEnvOptions {
  /** Injectable for tests targeting the local provider. */
  loadExtractor?: LocalEmbeddingProviderOptions["loadExtractor"];
  /** Injectable for tests targeting the openai provider. */
  fetchImpl?: typeof fetch;
}

/**
 * Unlike createLLMProviderFromEnv, this is a straight selection, not an
 * automatic failover chain — "local" has no quota/outage failure mode worth
 * falling back from, and "openai" is an explicit opt-in override (the
 * SOW §3.3 "such as ChatGPT" placeholder), not an automatic backup partner.
 * Defaults to "local" (free, self-hosted) whenever EMBEDDING_PROVIDER is
 * unset — see .claude/specs/knowledge-management.md's Dependencies section.
 */
export function createEmbeddingProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  opts?: CreateEmbeddingProviderFromEnvOptions,
): EmbeddingProvider {
  const selected: EmbeddingProviderName = env.EMBEDDING_PROVIDER === "openai" ? "openai" : "local";

  if (selected === "openai") {
    if (!env.OPENAI_API_KEY) {
      throw new Error(
        "EMBEDDING_PROVIDER=openai but OPENAI_API_KEY is not set — see .env.example.",
      );
    }
    return createOpenAIEmbeddingProvider({
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_EMBEDDING_MODEL,
      fetchImpl: opts?.fetchImpl,
    });
  }

  return createLocalEmbeddingProvider({ loadExtractor: opts?.loadExtractor });
}
