import type { TTSProvider, TTSSynthesizeOptions } from "./types.js";
import { logProviderEvent } from "./provider-log.js";
import { ProviderError } from "./provider-error.js";

export interface TTSProviderCandidate {
  name: string;
  provider: TTSProvider;
  /** Voice name for THIS candidate — primary/fallback providers have distinct voice namespaces. */
  voice: string;
}

export class AllTTSProvidersFailedError extends Error {
  constructor(public readonly attempted: string[]) {
    super(`All TTS providers failed: ${attempted.join(", ")}`);
    this.name = "AllTTSProvidersFailedError";
  }
}

export interface FailoverTTSProviderOptions {
  /**
   * Called once a candidate has served the first chunk of a synthesize()
   * call, with the mimeType that actually applies to THIS call's audio —
   * which provider serves a given sentence can vary call to call, so a
   * single static TTSProvider.mimeType is not authoritative once failover
   * is in play. Callers (conversation-service) must use this, not the
   * wrapper's own .mimeType, to set the WS message's mimeType correctly.
   */
  onResolved?: (name: string, mimeType: string) => void;
}

/** Same "any thrown error triggers failover" semantics as llm-failover.ts, scoped per synthesize() call (i.e. per sentence). */
export function createFailoverTTSProvider(
  candidates: TTSProviderCandidate[],
  opts?: FailoverTTSProviderOptions,
): TTSProvider {
  if (candidates.length === 0) {
    throw new Error("createFailoverTTSProvider requires at least one candidate");
  }

  return {
    name: "failover",
    // Best-effort default for callers that ignore onResolved — the actual
    // mimeType for a specific call may differ if that call failed over.
    mimeType: candidates[0]!.provider.mimeType,
    async *synthesize(text: string, _voice: string, synthOpts: TTSSynthesizeOptions): AsyncIterable<Uint8Array> {
      const attempted: string[] = [];

      for (const candidate of candidates) {
        attempted.push(candidate.name);
        const iterator = candidate.provider.synthesize(text, candidate.voice, synthOpts)[Symbol.asyncIterator]();

        let first: IteratorResult<Uint8Array>;
        try {
          first = await iterator.next();
        } catch (error) {
          logProviderEvent({
            hop: "tts",
            provider: candidate.name,
            phase: "failed",
            errorKind: error instanceof ProviderError ? error.kind : "other",
          });
          continue;
        }

        logProviderEvent({ hop: "tts", provider: candidate.name, phase: "served" });
        opts?.onResolved?.(candidate.name, candidate.provider.mimeType);

        if (!first.done) yield first.value;
        while (true) {
          const next = await iterator.next();
          if (next.done) break;
          yield next.value;
        }
        return;
      }

      throw new AllTTSProvidersFailedError(attempted);
    },
  };
}
