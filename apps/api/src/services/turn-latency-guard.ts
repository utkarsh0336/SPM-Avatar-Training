// latency-auditor's documented p95 mediated-mode TTFA budget — see
// .claude/agents/latency-auditor.md. Supersedes the informally-stated "≤2s"
// figure in .claude/specs/voice-quality-latency-enforcement.md's originating
// review: this is the number already authoritative elsewhere in this
// codebase, so it's the one enforced here rather than a second, looser one.
export const TURN_TTFA_BUDGET_MS = 1400;

const DEFAULT_CONSECUTIVE_MISSES_TO_TRIP = 3;

export interface TurnLatencyCircuitBreaker {
  /**
   * Called once per completed turn. `ttsFirstChunkMs` is
   * TurnLatencyBreakdown.ttsFirstChunkMs — `undefined` means the turn
   * finished without ever synthesizing a sentence (e.g. an empty LLM reply);
   * that's "no audio attempted," not "audio was slow," so it's a no-op —
   * it neither extends nor resets the org's miss streak.
   */
  recordTurn(orgId: string, ttsFirstChunkMs: number | undefined): void;
  isTripped(orgId: string): boolean;
}

/**
 * Per-process, in-memory — NOT Redis-backed. Mirrors the accepted precedent
 * in apps/api/src/lib/rate-limit.ts, which documents exactly this trade-off:
 * "Redis-backed distributed limiting is an explicit spec non-goal — this
 * per-process approximation is acceptable as-is." A rolling per-org streak
 * of consecutive over-budget turns; trips at `consecutiveMissesToTrip`,
 * resets the moment a turn for that org comes in under budget.
 */
export function createTurnLatencyCircuitBreaker(opts?: {
  consecutiveMissesToTrip?: number;
  budgetMs?: number;
}): TurnLatencyCircuitBreaker {
  const consecutiveMissesToTrip = opts?.consecutiveMissesToTrip ?? DEFAULT_CONSECUTIVE_MISSES_TO_TRIP;
  const budgetMs = opts?.budgetMs ?? TURN_TTFA_BUDGET_MS;
  const streaks = new Map<string, number>();

  return {
    recordTurn(orgId, ttsFirstChunkMs) {
      if (ttsFirstChunkMs === undefined) return;
      if (ttsFirstChunkMs > budgetMs) {
        streaks.set(orgId, (streaks.get(orgId) ?? 0) + 1);
      } else {
        streaks.delete(orgId);
      }
    },
    isTripped(orgId) {
      return (streaks.get(orgId) ?? 0) >= consecutiveMissesToTrip;
    },
  };
}

// Module-level singleton — same cross-connection, cross-turn persistence
// requirement as rate-limit.ts's own module-level Map. createConversationHandler
// runs one instance per WS connection, so a breaker constructed fresh inside
// it would never see more than one connection's turns; this is what actually
// gives the breaker signal across a session (and across an org's concurrent
// sessions in this process).
export const defaultTurnLatencyCircuitBreaker: TurnLatencyCircuitBreaker = createTurnLatencyCircuitBreaker();

/**
 * One-shot watchdog for a turn's time-to-first-audio. Fires `onExceeded()`
 * once, `budgetMs` after creation, unless cleared first or `signal` aborts
 * first (barge-in safety — a stale "still working" signal must never fire
 * after the turn was cancelled). Returns a clear function; calling it more
 * than once, or after it already fired, is a no-op.
 */
export function startTurnLatencyWatchdog(budgetMs: number, signal: AbortSignal, onExceeded: () => void): () => void {
  const timer = setTimeout(onExceeded, budgetMs);
  const clear = () => clearTimeout(timer);
  signal.addEventListener("abort", clear, { once: true });
  return () => {
    clear();
    signal.removeEventListener("abort", clear);
  };
}
