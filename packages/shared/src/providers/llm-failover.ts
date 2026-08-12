import type { LLMChatOptions, LLMMessage, LLMProvider, LLMStreamEvent } from "./types.js";
import { logProviderEvent } from "./provider-log.js";
import { ProviderError } from "./provider-error.js";

export interface LLMProviderCandidate {
  name: string;
  provider: LLMProvider;
}

export class AllLLMProvidersFailedError extends Error {
  constructor(public readonly attempted: string[]) {
    super(`All LLM providers failed: ${attempted.join(", ")}`);
    this.name = "AllLLMProvidersFailedError";
  }
}

export interface FailoverLLMProviderOptions {
  /** Called once a candidate has successfully yielded its first chunk. */
  onResolved?: (name: string) => void;
}

/**
 * Tries each candidate in order, falling through on ANY thrown error from
 * the candidate's first chunk — not just classified 429/5xx. This is
 * deliberately broader than the brief's literal "on 429 or 5xx" wording:
 * the DoD requires a deliberately invalid API key (401/403) to also trigger
 * failover, and a narrower rule would fail that test. See the plan file's
 * "Deliberate broadening" note.
 *
 * Once a candidate has yielded its first chunk, failover stops — a
 * mid-stream death after that point surfaces as a thrown error from the
 * combined iterator (conversation-service turns it into turn.failed),
 * rather than silently retrying and duplicating partial output.
 */
export function createFailoverLLMProvider(
  candidates: LLMProviderCandidate[],
  opts?: FailoverLLMProviderOptions,
): LLMProvider {
  if (candidates.length === 0) {
    throw new Error("createFailoverLLMProvider requires at least one candidate");
  }

  return {
    name: "failover",
    async *chat(messages: LLMMessage[], chatOpts: LLMChatOptions): AsyncIterable<LLMStreamEvent> {
      const attempted: string[] = [];

      for (const candidate of candidates) {
        attempted.push(candidate.name);
        const iterator = candidate.provider.chat(messages, chatOpts)[Symbol.asyncIterator]();

        let first: IteratorResult<LLMStreamEvent>;
        try {
          first = await iterator.next();
        } catch (error) {
          logProviderEvent({
            hop: "llm",
            provider: candidate.name,
            phase: "failed",
            errorKind: error instanceof ProviderError ? error.kind : "other",
          });
          continue;
        }

        logProviderEvent({ hop: "llm", provider: candidate.name, phase: "served" });
        opts?.onResolved?.(candidate.name);

        if (!first.done) yield first.value;
        while (true) {
          const next = await iterator.next();
          if (next.done) break;
          yield next.value;
        }
        return;
      }

      throw new AllLLMProvidersFailedError(attempted);
    },
  };
}
