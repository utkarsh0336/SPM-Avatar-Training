import type { LLMProvider } from "./types.js";
import { createGeminiLLMProvider } from "./llm-gemini.js";
import { createGroqLLMProvider } from "./llm-groq.js";
import { createFailoverLLMProvider, type LLMProviderCandidate } from "./llm-failover.js";

export type LLMProviderName = "gemini" | "groq";

export interface CreateLLMProviderFromEnvOptions {
  /** Called once a candidate has served the first token of a turn. */
  onResolved?: (name: string) => void;
  /** Injectable for tests; defaults to the global fetch for both adapters. */
  fetchImpl?: typeof fetch;
}

/**
 * LLM_PROVIDER picks which configured provider is tried first; whichever
 * other provider has a key configured becomes the automatic fallback. This
 * is what makes "switch LLM_PROVIDER from gemini to groq, restart, no code
 * edits" (DoD) meaningful while still satisfying "automatic failover" (§4)
 * — the env var picks the primary, not the only provider.
 */
export function createLLMProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  opts?: CreateLLMProviderFromEnvOptions,
): LLMProvider {
  const primary: LLMProviderName = env.LLM_PROVIDER === "groq" ? "groq" : "gemini";

  const gemini: LLMProviderCandidate | null = env.GEMINI_API_KEY
    ? {
        name: "gemini",
        provider: createGeminiLLMProvider({
          apiKey: env.GEMINI_API_KEY,
          model: env.GEMINI_LLM_MODEL,
          fetchImpl: opts?.fetchImpl,
        }),
      }
    : null;
  const groq: LLMProviderCandidate | null = env.GROQ_API_KEY
    ? {
        name: "groq",
        provider: createGroqLLMProvider({
          apiKey: env.GROQ_API_KEY,
          model: env.GROQ_LLM_MODEL,
          fetchImpl: opts?.fetchImpl,
        }),
      }
    : null;

  const ordered = primary === "groq" ? [groq, gemini] : [gemini, groq];
  const candidates = ordered.filter((c): c is LLMProviderCandidate => c !== null);

  if (candidates.length === 0) {
    throw new Error(
      "No LLM provider configured — set GEMINI_API_KEY and/or GROQ_API_KEY in .env (see .env.example).",
    );
  }

  return createFailoverLLMProvider(candidates, { onResolved: opts?.onResolved });
}
