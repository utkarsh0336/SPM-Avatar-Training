export type TeardownReason = "last_human_left" | "idle_timeout" | "max_duration";

export interface TeardownWatcherOptions {
  /** Grace period after the last human leaves, to tolerate a brief reconnect. */
  lastHumanGraceMs: number;
  /** How long the room may sit with no recorded activity before tearing down. */
  idleTimeoutMs: number;
  /** Hard cap on total session length, regardless of activity. */
  maxSessionMs: number;
  /** Fires exactly once, for whichever of the three conditions triggers first. */
  onTeardown: (reason: TeardownReason) => void;
  /** Injectable for tests; default to the real timer functions. */
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
}

export interface TeardownWatcher {
  /** Call on any turn activity (speech start, turn processed, etc.) — resets the idle timer. */
  recordActivity(): void;
  /** Call when the last non-agent participant leaves the room — starts the grace-period countdown. */
  onLastHumanLeft(): void;
  /** Call when a human (re)joins before the grace period elapses — cancels the pending teardown. */
  onHumanRejoined(): void;
  /** Cancels every pending timer without firing onTeardown — for a caller that already tore down some other way. */
  dispose(): void;
}

/**
 * The three exit conditions from docs/ARCHITECTURE.md §4's worker
 * lifecycle. Whichever fires first wins — onTeardown fires exactly once,
 * every other pending timer is cancelled immediately after.
 */
export function createTeardownWatcher(options: TeardownWatcherOptions): TeardownWatcher {
  const scheduleTimeout = options.setTimeout ?? setTimeout;
  const cancelTimeout = options.clearTimeout ?? clearTimeout;

  let firedOrDisposed = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let lastHumanGraceTimer: ReturnType<typeof setTimeout> | null = null;
  const maxSessionTimer = scheduleTimeout(() => fire("max_duration"), options.maxSessionMs);

  function clearAllTimers(): void {
    if (idleTimer) cancelTimeout(idleTimer);
    if (lastHumanGraceTimer) cancelTimeout(lastHumanGraceTimer);
    cancelTimeout(maxSessionTimer);
    idleTimer = null;
    lastHumanGraceTimer = null;
  }

  function fire(reason: TeardownReason): void {
    if (firedOrDisposed) return;
    firedOrDisposed = true;
    clearAllTimers();
    options.onTeardown(reason);
  }

  function resetIdleTimer(): void {
    if (firedOrDisposed) return;
    if (idleTimer) cancelTimeout(idleTimer);
    idleTimer = scheduleTimeout(() => fire("idle_timeout"), options.idleTimeoutMs);
  }
  resetIdleTimer();

  return {
    recordActivity(): void {
      resetIdleTimer();
    },
    onLastHumanLeft(): void {
      if (firedOrDisposed || lastHumanGraceTimer) return;
      lastHumanGraceTimer = scheduleTimeout(() => fire("last_human_left"), options.lastHumanGraceMs);
    },
    onHumanRejoined(): void {
      if (lastHumanGraceTimer) {
        cancelTimeout(lastHumanGraceTimer);
        lastHumanGraceTimer = null;
      }
    },
    dispose(): void {
      if (firedOrDisposed) return;
      firedOrDisposed = true;
      clearAllTimers();
    },
  };
}
