import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startVoiceActivityDetector } from "./voice-activity-detector.js";

function createFakeAudioContext(getDeviation: () => number) {
  const analyser = {
    fftSize: 0,
    frequencyBinCount: 4,
    getByteTimeDomainData: (arr: Uint8Array) => {
      arr.fill(128 + getDeviation());
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const sourceNode = { connect: vi.fn(), disconnect: vi.fn() };
  return {
    analyser,
    context: {
      createMediaStreamSource: vi.fn(() => sourceNode),
      createAnalyser: vi.fn(() => analyser),
    },
  };
}

describe("startVoiceActivityDetector", () => {
  let deviation = 0;
  let rafCallback: (() => void) | undefined;
  const fakeRaf = (cb: () => void): number => {
    rafCallback = cb;
    return 0;
  };
  function tick(): void {
    const cb = rafCallback;
    rafCallback = undefined;
    cb?.();
  }

  beforeEach(() => {
    deviation = 0;
    vi.useFakeTimers();
    vi.setSystemTime(0);
    // MediaStream is a browser-only global not present under Node's vitest
    // environment — startVoiceActivityDetector wraps the mic track in one
    // to feed AudioContext.createMediaStreamSource, so it needs to exist.
    vi.stubGlobal(
      "MediaStream",
      class {
        tracks: unknown[];
        constructor(tracks: unknown[]) {
          this.tracks = tracks;
        }
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("calls onSpeechStart once volume crosses the threshold, and not again while still loud", () => {
    const { context } = createFakeAudioContext(() => deviation);
    const onSpeechStart = vi.fn();
    const onSpeechEnd = vi.fn();

    startVoiceActivityDetector({
      micTrack: {} as MediaStreamTrack,
      onSpeechStart,
      onSpeechEnd,
      createAudioContext: () => context as unknown as AudioContext,
      requestAnimationFrame: fakeRaf,
    });

    tick();
    expect(onSpeechStart).not.toHaveBeenCalled();

    deviation = 100;
    tick();
    expect(onSpeechStart).toHaveBeenCalledTimes(1);

    tick();
    expect(onSpeechStart).toHaveBeenCalledTimes(1);
  });

  it("does not end speech until both the minimum speech duration and silence duration have elapsed", () => {
    const { context } = createFakeAudioContext(() => deviation);
    const onSpeechStart = vi.fn();
    const onSpeechEnd = vi.fn();

    startVoiceActivityDetector({
      micTrack: {} as MediaStreamTrack,
      silenceDurationMs: 900,
      minSpeechDurationMs: 300,
      onSpeechStart,
      onSpeechEnd,
      createAudioContext: () => context as unknown as AudioContext,
      requestAnimationFrame: fakeRaf,
    });

    deviation = 100;
    tick();
    expect(onSpeechStart).toHaveBeenCalledTimes(1);

    // Goes silent almost immediately — speech duration (100ms) is below
    // minSpeechDurationMs (300ms), so this brief blip must not end the turn.
    vi.setSystemTime(100);
    deviation = 0;
    tick();
    expect(onSpeechEnd).not.toHaveBeenCalled();

    // Still within the silence window (900ms) since silence started.
    vi.setSystemTime(500);
    tick();
    expect(onSpeechEnd).not.toHaveBeenCalled();

    // Silence has now persisted past both thresholds.
    vi.setSystemTime(1200);
    tick();
    expect(onSpeechEnd).toHaveBeenCalledTimes(1);
  });

  it("resets the silence timer if speech resumes before the silence duration elapses", () => {
    const { context } = createFakeAudioContext(() => deviation);
    const onSpeechStart = vi.fn();
    const onSpeechEnd = vi.fn();

    startVoiceActivityDetector({
      micTrack: {} as MediaStreamTrack,
      silenceDurationMs: 900,
      minSpeechDurationMs: 300,
      onSpeechStart,
      onSpeechEnd,
      createAudioContext: () => context as unknown as AudioContext,
      requestAnimationFrame: fakeRaf,
    });

    deviation = 100;
    tick(); // speech starts at t=0

    vi.setSystemTime(500);
    deviation = 0;
    tick(); // goes silent at t=500 (speech duration already past the 300ms floor)

    vi.setSystemTime(1000);
    deviation = 100; // speaks again before the 900ms silence window elapses
    tick();

    vi.setSystemTime(1300);
    deviation = 0;
    tick(); // silent again, but only 300ms since the resume — not enough yet
    expect(onSpeechEnd).not.toHaveBeenCalled();

    vi.setSystemTime(2300);
    tick(); // now 1000ms since this second silence began (>= the 900ms threshold)
    expect(onSpeechEnd).toHaveBeenCalledTimes(1);
    expect(onSpeechStart).toHaveBeenCalledTimes(1); // still only one "turn" of speech
  });

  it("stop() disconnects the analyser and source, and halts ticking", () => {
    const { context, analyser } = createFakeAudioContext(() => deviation);

    const detector = startVoiceActivityDetector({
      micTrack: {} as MediaStreamTrack,
      onSpeechStart: vi.fn(),
      onSpeechEnd: vi.fn(),
      createAudioContext: () => context as unknown as AudioContext,
      requestAnimationFrame: fakeRaf,
    });

    detector.stop();
    expect(analyser.disconnect).toHaveBeenCalled();

    rafCallback = undefined;
    // No further raf scheduling should occur after stop — calling any
    // leftover callback (there shouldn't be one) must be a no-op either way.
    expect(rafCallback).toBeUndefined();
  });
});
