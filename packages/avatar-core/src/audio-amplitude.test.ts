import { describe, expect, it, vi } from "vitest";
import { startAudioAmplitudeLoop } from "./audio-amplitude.js";

function createFakeAnalyser(byteValue: number) {
  return {
    frequencyBinCount: 4,
    getByteTimeDomainData: vi.fn((arr: Uint8Array) => arr.fill(byteValue)),
  } as unknown as AnalyserNode;
}

function createFakeRaf() {
  let nextHandle = 1;
  const pending = new Map<number, () => void>();
  const raf = vi.fn((cb: () => void) => {
    const handle = nextHandle++;
    pending.set(handle, cb);
    return handle;
  });
  const caf = vi.fn((handle: number) => pending.delete(handle));
  const tick = () => {
    const callbacks = [...pending.values()];
    pending.clear();
    callbacks.forEach((cb) => cb());
  };
  return { raf, caf, tick };
}

describe("startAudioAmplitudeLoop", () => {
  it("reports 0 amplitude for silence (byte value 128 everywhere)", () => {
    const analyser = createFakeAnalyser(128);
    const raf = createFakeRaf();
    const onAmplitudeChange = vi.fn();

    startAudioAmplitudeLoop(analyser, onAmplitudeChange, { requestAnimationFrame: raf.raf, cancelAnimationFrame: raf.caf });
    raf.tick();

    expect(onAmplitudeChange).toHaveBeenLastCalledWith(0);
  });

  it("reports non-zero amplitude for a loud signal (byte value 255 everywhere)", () => {
    const analyser = createFakeAnalyser(255);
    const raf = createFakeRaf();
    const onAmplitudeChange = vi.fn();

    startAudioAmplitudeLoop(analyser, onAmplitudeChange, { requestAnimationFrame: raf.raf, cancelAnimationFrame: raf.caf });
    raf.tick();

    expect(onAmplitudeChange).toHaveBeenLastCalledWith(expect.any(Number));
    expect(onAmplitudeChange.mock.calls[0]![0]).toBeGreaterThan(0);
  });

  it("keeps scheduling itself until stop() is called", () => {
    const analyser = createFakeAnalyser(128);
    const raf = createFakeRaf();
    const handle = startAudioAmplitudeLoop(analyser, vi.fn(), { requestAnimationFrame: raf.raf, cancelAnimationFrame: raf.caf });

    raf.tick();
    raf.tick();
    expect(raf.raf).toHaveBeenCalledTimes(3); // initial schedule + 2 re-schedules from tick()

    handle.stop();
    expect(raf.caf).toHaveBeenCalled();
  });

  it("stop() reports a final amplitude of 0 and is idempotent", () => {
    const analyser = createFakeAnalyser(255);
    const raf = createFakeRaf();
    const onAmplitudeChange = vi.fn();
    const handle = startAudioAmplitudeLoop(analyser, onAmplitudeChange, {
      requestAnimationFrame: raf.raf,
      cancelAnimationFrame: raf.caf,
    });

    handle.stop();
    expect(onAmplitudeChange).toHaveBeenLastCalledWith(0);

    onAmplitudeChange.mockClear();
    handle.stop();
    expect(onAmplitudeChange).not.toHaveBeenCalled();
  });

  it("a tick fired after stop() does not resume scheduling", () => {
    const analyser = createFakeAnalyser(128);
    const raf = createFakeRaf();
    const handle = startAudioAmplitudeLoop(analyser, vi.fn(), { requestAnimationFrame: raf.raf, cancelAnimationFrame: raf.caf });
    handle.stop();

    const callsBefore = raf.raf.mock.calls.length;
    raf.tick(); // no-op: caf already removed the pending callback
    expect(raf.raf.mock.calls.length).toBe(callsBefore);
  });
});
