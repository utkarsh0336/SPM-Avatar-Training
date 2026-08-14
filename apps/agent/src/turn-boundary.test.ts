import { describe, expect, it, vi } from "vitest";
import { createTurnBoundaryDetector } from "./turn-boundary.js";

function createFakeClock(startMs = 0) {
  let current = startMs;
  return { now: () => current, advance: (ms: number) => (current += ms) };
}

describe("createTurnBoundaryDetector", () => {
  it("does not fire onSpeechStart for frames below the silence threshold", () => {
    const onSpeechStart = vi.fn();
    const detector = createTurnBoundaryDetector({ onSpeechStart, onSpeechEnd: vi.fn() });
    detector.pushFrameRms(0.01);
    detector.pushFrameRms(0.019);
    expect(onSpeechStart).not.toHaveBeenCalled();
  });

  it("fires onSpeechStart on the first frame above threshold", () => {
    const onSpeechStart = vi.fn();
    const detector = createTurnBoundaryDetector({ onSpeechStart, onSpeechEnd: vi.fn() });
    detector.pushFrameRms(0.5);
    expect(onSpeechStart).toHaveBeenCalledTimes(1);
    detector.pushFrameRms(0.5); // stays speaking — no duplicate fire
    expect(onSpeechStart).toHaveBeenCalledTimes(1);
  });

  it("does not fire onSpeechEnd until both minSpeechDurationMs and silenceDurationMs have elapsed", () => {
    // minSpeechDurationMs > silenceDurationMs here specifically so the two
    // gates are independently observable — with the (realistic) reverse
    // relationship silenceDurationMs's own elapsed time already implies
    // speechDuration has cleared a smaller minSpeechDurationMs, since
    // speechStartedAt always precedes silenceStartedAt.
    const clock = createFakeClock();
    const onSpeechEnd = vi.fn();
    const detector = createTurnBoundaryDetector({
      onSpeechStart: vi.fn(),
      onSpeechEnd,
      now: clock.now,
      minSpeechDurationMs: 1000,
      silenceDurationMs: 200,
    });

    detector.pushFrameRms(0.5); // speech starts at t=0
    clock.advance(100);
    detector.pushFrameRms(0.0); // silence begins at t=100
    clock.advance(200); // silenceDurationMs satisfied at t=300, but speechDuration (300ms) < minSpeechDurationMs (1000ms)
    detector.pushFrameRms(0.0);
    expect(onSpeechEnd).not.toHaveBeenCalled();

    clock.advance(700); // t=1000 — speechDuration now satisfied too
    detector.pushFrameRms(0.0);
    expect(onSpeechEnd).toHaveBeenCalledTimes(1);
  });

  it("fires onSpeechEnd once both thresholds are satisfied", () => {
    const clock = createFakeClock();
    const onSpeechEnd = vi.fn();
    const detector = createTurnBoundaryDetector({
      onSpeechStart: vi.fn(),
      onSpeechEnd,
      now: clock.now,
      minSpeechDurationMs: 300,
      silenceDurationMs: 700,
    });

    detector.pushFrameRms(0.5); // speech starts at t=0
    clock.advance(400); // well past minSpeechDurationMs
    detector.pushFrameRms(0.0); // silence begins at t=400
    clock.advance(700);
    detector.pushFrameRms(0.0); // t=1100, silence duration 700ms
    expect(onSpeechEnd).toHaveBeenCalledTimes(1);
  });

  it("resets the silence timer if speech resumes before silenceDurationMs elapses", () => {
    const clock = createFakeClock();
    const onSpeechEnd = vi.fn();
    const detector = createTurnBoundaryDetector({
      onSpeechStart: vi.fn(),
      onSpeechEnd,
      now: clock.now,
      minSpeechDurationMs: 300,
      silenceDurationMs: 700,
    });

    detector.pushFrameRms(0.5);
    clock.advance(400);
    detector.pushFrameRms(0.0); // silence begins
    clock.advance(300); // not yet 700ms of silence
    detector.pushFrameRms(0.5); // speech resumes — silence timer resets
    clock.advance(700);
    detector.pushFrameRms(0.0);
    // Only 700ms of silence has elapsed since the SECOND speech segment
    // resumed (not from the first silence onset) — onSpeechEnd shouldn't
    // have fired from the interrupted first silence window.
    clock.advance(700);
    detector.pushFrameRms(0.0);
    expect(onSpeechEnd).toHaveBeenCalledTimes(1);
  });

  it("reset() clears state so a new speech segment starts fresh", () => {
    const onSpeechStart = vi.fn();
    const detector = createTurnBoundaryDetector({ onSpeechStart, onSpeechEnd: vi.fn() });
    detector.pushFrameRms(0.5);
    detector.reset();
    detector.pushFrameRms(0.5);
    expect(onSpeechStart).toHaveBeenCalledTimes(2);
  });
});
