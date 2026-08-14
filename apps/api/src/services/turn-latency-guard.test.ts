import { describe, expect, it, vi } from "vitest";
import { createTurnLatencyCircuitBreaker, startTurnLatencyWatchdog } from "./turn-latency-guard.js";

describe("createTurnLatencyCircuitBreaker", () => {
  it("is not tripped before any turns are recorded", () => {
    const breaker = createTurnLatencyCircuitBreaker({ budgetMs: 1000 });
    expect(breaker.isTripped("org-1")).toBe(false);
  });

  it("stays untripped through 1-2 consecutive over-budget turns, trips on the 3rd", () => {
    const breaker = createTurnLatencyCircuitBreaker({ budgetMs: 1000, consecutiveMissesToTrip: 3 });
    breaker.recordTurn("org-1", 1500);
    expect(breaker.isTripped("org-1")).toBe(false);
    breaker.recordTurn("org-1", 1600);
    expect(breaker.isTripped("org-1")).toBe(false);
    breaker.recordTurn("org-1", 1700);
    expect(breaker.isTripped("org-1")).toBe(true);
  });

  it("resets the streak the next time a turn comes in under budget", () => {
    const breaker = createTurnLatencyCircuitBreaker({ budgetMs: 1000, consecutiveMissesToTrip: 3 });
    breaker.recordTurn("org-1", 1500);
    breaker.recordTurn("org-1", 1500);
    breaker.recordTurn("org-1", 1500);
    expect(breaker.isTripped("org-1")).toBe(true);

    breaker.recordTurn("org-1", 500);
    expect(breaker.isTripped("org-1")).toBe(false);

    // The reset streak must build back up from zero, not resume near the trip threshold.
    breaker.recordTurn("org-1", 1500);
    breaker.recordTurn("org-1", 1500);
    expect(breaker.isTripped("org-1")).toBe(false);
  });

  it("treats a turn with no synthesized audio (ttsFirstChunkMs undefined) as a no-op", () => {
    const breaker = createTurnLatencyCircuitBreaker({ budgetMs: 1000, consecutiveMissesToTrip: 3 });
    breaker.recordTurn("org-1", 1500);
    breaker.recordTurn("org-1", 1500);
    breaker.recordTurn("org-1", undefined); // must not extend the streak
    expect(breaker.isTripped("org-1")).toBe(false);
    breaker.recordTurn("org-1", 1500);
    expect(breaker.isTripped("org-1")).toBe(true);

    // Also must not reset an already-tripped streak.
    breaker.recordTurn("org-1", undefined);
    expect(breaker.isTripped("org-1")).toBe(true);
  });

  it("isolates orgs on one shared breaker instance", () => {
    const breaker = createTurnLatencyCircuitBreaker({ budgetMs: 1000, consecutiveMissesToTrip: 3 });
    breaker.recordTurn("org-1", 1500);
    breaker.recordTurn("org-1", 1500);
    breaker.recordTurn("org-1", 1500);
    expect(breaker.isTripped("org-1")).toBe(true);
    expect(breaker.isTripped("org-2")).toBe(false);

    breaker.recordTurn("org-2", 1500);
    expect(breaker.isTripped("org-2")).toBe(false);
  });
});

describe("startTurnLatencyWatchdog", () => {
  it("fires onExceeded exactly budgetMs after creation", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const onExceeded = vi.fn();
      startTurnLatencyWatchdog(1000, controller.signal, onExceeded);

      await vi.advanceTimersByTimeAsync(999);
      expect(onExceeded).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(onExceeded).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not fire if cleared before the budget elapses", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const onExceeded = vi.fn();
      const clear = startTurnLatencyWatchdog(1000, controller.signal, onExceeded);

      clear();
      await vi.advanceTimersByTimeAsync(1000);
      expect(onExceeded).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not fire once the signal aborts", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const onExceeded = vi.fn();
      startTurnLatencyWatchdog(1000, controller.signal, onExceeded);

      controller.abort();
      await vi.advanceTimersByTimeAsync(1000);
      expect(onExceeded).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("the returned clear function is idempotent", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const onExceeded = vi.fn();
      const clear = startTurnLatencyWatchdog(1000, controller.signal, onExceeded);

      clear();
      expect(() => clear()).not.toThrow();
      await vi.advanceTimersByTimeAsync(1000);
      expect(onExceeded).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
