export interface TurnLatencyServedBy {
  llm?: string;
  stt?: string;
  tts?: string;
}

export interface TurnLatencyBreakdown {
  turnId: string;
  sttMs?: number;
  /** Knowledge retrieval — see .claude/specs/knowledge-management.md. Marked between STT and the LLM call; docs/ARCHITECTURE.md §5 sets a <100ms p95 budget. */
  retrievalMs?: number;
  llmFirstTokenMs?: number;
  ttsFirstChunkMs?: number;
  totalMs: number;
  servedBy?: TurnLatencyServedBy;
}

/**
 * One structured JSON log line per turn — brief §8's "log every provider
 * call with latency" plus the DoD's per-hop timing requirement. apps/api
 * runs Fastify({logger:false}), so this is the only record of these
 * numbers; also forwarded verbatim in the `latency` WS message so the
 * client/DoD verification can read it without grepping server logs.
 */
export function logTurnLatency(entry: TurnLatencyBreakdown): void {
  console.log(JSON.stringify({ event: "turn_latency", ...entry, at: new Date().toISOString() }));
}

export interface TurnLatencyTracker {
  markSttDone(): void;
  markRetrievalDone(): void;
  markLlmFirstToken(): void;
  markTtsFirstChunk(): void;
  /** Computes totalMs, logs the entry, and returns it. */
  finish(servedBy?: TurnLatencyServedBy): TurnLatencyBreakdown;
}

/** Injectable for tests; defaults to the real clock. */
export function createTurnLatencyTracker(
  turnId: string,
  now: () => number = () => performance.now(),
): TurnLatencyTracker {
  const start = now();
  let sttMs: number | undefined;
  let retrievalMs: number | undefined;
  let llmFirstTokenMs: number | undefined;
  let ttsFirstChunkMs: number | undefined;

  return {
    markSttDone() {
      sttMs = now() - start;
    },
    markRetrievalDone() {
      retrievalMs = now() - start;
    },
    markLlmFirstToken() {
      llmFirstTokenMs = now() - start;
    },
    markTtsFirstChunk() {
      ttsFirstChunkMs = now() - start;
    },
    finish(servedBy) {
      const entry: TurnLatencyBreakdown = {
        turnId,
        sttMs,
        retrievalMs,
        llmFirstTokenMs,
        ttsFirstChunkMs,
        totalMs: now() - start,
        servedBy,
      };
      logTurnLatency(entry);
      return entry;
    },
  };
}
