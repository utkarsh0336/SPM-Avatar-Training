import { describe, expect, it, vi } from "vitest";
import { createTeardownWatcher } from "./teardown.js";

const baseOptions = { lastHumanGraceMs: 15_000, idleTimeoutMs: 300_000, maxSessionMs: 1_800_000 };

describe("createTeardownWatcher", () => {
  it("fires idle_timeout exactly once when no activity is recorded", () => {
    vi.useFakeTimers();
    const onTeardown = vi.fn();
    createTeardownWatcher({ ...baseOptions, onTeardown });

    vi.advanceTimersByTime(baseOptions.idleTimeoutMs);

    expect(onTeardown).toHaveBeenCalledTimes(1);
    expect(onTeardown).toHaveBeenCalledWith("idle_timeout");
    vi.useRealTimers();
  });

  it("recordActivity() resets the idle timer, so idle_timeout doesn't fire prematurely", () => {
    vi.useFakeTimers();
    const onTeardown = vi.fn();
    const watcher = createTeardownWatcher({ ...baseOptions, onTeardown });

    vi.advanceTimersByTime(baseOptions.idleTimeoutMs - 1000);
    watcher.recordActivity();
    vi.advanceTimersByTime(baseOptions.idleTimeoutMs - 1000);
    expect(onTeardown).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(onTeardown).toHaveBeenCalledWith("idle_timeout");
    vi.useRealTimers();
  });

  it("fires last_human_left after the grace period once the last human leaves", () => {
    vi.useFakeTimers();
    const onTeardown = vi.fn();
    const watcher = createTeardownWatcher({ ...baseOptions, onTeardown });

    watcher.onLastHumanLeft();
    vi.advanceTimersByTime(baseOptions.lastHumanGraceMs - 1);
    expect(onTeardown).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onTeardown).toHaveBeenCalledTimes(1);
    expect(onTeardown).toHaveBeenCalledWith("last_human_left");
    vi.useRealTimers();
  });

  it("onHumanRejoined() cancels the pending last_human_left teardown", () => {
    vi.useFakeTimers();
    const onTeardown = vi.fn();
    const watcher = createTeardownWatcher({ ...baseOptions, onTeardown });

    watcher.onLastHumanLeft();
    vi.advanceTimersByTime(baseOptions.lastHumanGraceMs / 2);
    watcher.onHumanRejoined();
    vi.advanceTimersByTime(baseOptions.lastHumanGraceMs);

    expect(onTeardown).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("fires max_duration exactly once at the hard cap, regardless of activity", () => {
    vi.useFakeTimers();
    const onTeardown = vi.fn();
    const watcher = createTeardownWatcher({ ...baseOptions, onTeardown });

    // Keep resetting the idle timer so it never fires — max_duration should
    // still fire on schedule.
    const interval = setInterval(() => watcher.recordActivity(), 1000);
    vi.advanceTimersByTime(baseOptions.maxSessionMs);
    clearInterval(interval);

    expect(onTeardown).toHaveBeenCalledTimes(1);
    expect(onTeardown).toHaveBeenCalledWith("max_duration");
    vi.useRealTimers();
  });

  it("whichever condition fires first wins — onTeardown never fires twice", () => {
    vi.useFakeTimers();
    const onTeardown = vi.fn();
    const watcher = createTeardownWatcher({ ...baseOptions, onTeardown });

    watcher.onLastHumanLeft();
    vi.advanceTimersByTime(baseOptions.lastHumanGraceMs); // last_human_left fires first
    vi.advanceTimersByTime(baseOptions.maxSessionMs); // max_duration's timer would also fire here, if not cancelled

    expect(onTeardown).toHaveBeenCalledTimes(1);
    expect(onTeardown).toHaveBeenCalledWith("last_human_left");
    vi.useRealTimers();
  });

  it("dispose() cancels all pending timers without firing onTeardown", () => {
    vi.useFakeTimers();
    const onTeardown = vi.fn();
    const watcher = createTeardownWatcher({ ...baseOptions, onTeardown });

    watcher.dispose();
    vi.advanceTimersByTime(Math.max(baseOptions.idleTimeoutMs, baseOptions.maxSessionMs) + 1000);

    expect(onTeardown).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
