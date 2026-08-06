/**
 * In-memory sliding-window rate limit, keyed by caller-provided string
 * (e.g. "email+ip"). Redis-backed distributed limiting is an explicit
 * spec non-goal — this per-process approximation is acceptable as-is;
 * apps/api is stateless but not (yet) horizontally scaled.
 */
const attempts = new Map<string, number[]>();

export interface RateLimitOptions {
  windowMs?: number;
  max?: number;
}

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX = 10;

// Keys are attacker-influenced (email+ip) — without periodic eviction, many
// distinct fake emails would grow this map unbounded. Sweep on a call
// counter rather than a timer, so this stays a passive cost with no extra
// process handle. Bound is generous relative to any windowMs actually used.
const MAX_ENTRY_AGE_MS = 5 * 60_000;
const SWEEP_EVERY_N_CALLS = 500;
let callsSinceSweep = 0;

function sweep(now: number): void {
  for (const [key, timestamps] of attempts) {
    const recent = timestamps.filter((t) => now - t < MAX_ENTRY_AGE_MS);
    if (recent.length === 0) attempts.delete(key);
    else attempts.set(key, recent);
  }
}

export function checkRateLimit(key: string, options?: RateLimitOptions): boolean {
  const windowMs = options?.windowMs ?? DEFAULT_WINDOW_MS;
  const max = options?.max ?? DEFAULT_MAX;
  const now = Date.now();

  callsSinceSweep += 1;
  if (callsSinceSweep >= SWEEP_EVERY_N_CALLS) {
    callsSinceSweep = 0;
    sweep(now);
  }

  const recent = (attempts.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    attempts.set(key, recent);
    return false;
  }

  recent.push(now);
  attempts.set(key, recent);
  return true;
}
