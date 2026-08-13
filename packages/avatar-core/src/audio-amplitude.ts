export interface AudioAmplitudeLoopOptions {
  /** Injectable for tests; defaults to the browser's requestAnimationFrame. */
  requestAnimationFrame?: (callback: () => void) => number;
  /** Injectable for tests; defaults to the browser's cancelAnimationFrame. */
  cancelAnimationFrame?: (handle: number) => void;
}

export interface AudioAmplitudeLoopHandle {
  /** Cancels the loop and reports a final amplitude of 0. */
  stop(): void;
}

/**
 * Extracted from mock-avatar-provider.ts (was inlined there) — both it and
 * vrm-avatar-provider.ts need the same RMS-amplitude-from-AnalyserNode loop,
 * the former to drive a UI pulse, the latter to also drive VRM mouth-open
 * blending (vrm-expression-driver.ts). Resolved lazily via globalThis, not
 * bound at call time, so a caller that never needs a real rAF (e.g. a test
 * that never calls speak()) doesn't need one to exist.
 */
export function startAudioAmplitudeLoop(
  analyser: AnalyserNode,
  onAmplitudeChange: (amplitude: number) => void,
  options: AudioAmplitudeLoopOptions = {},
): AudioAmplitudeLoopHandle {
  const raf = (callback: () => void): number =>
    (options.requestAnimationFrame ?? globalThis.requestAnimationFrame)(callback);
  const caf = (handle: number): void => (options.cancelAnimationFrame ?? globalThis.cancelAnimationFrame)?.(handle);

  const data = new Uint8Array(analyser.frequencyBinCount);
  let handle: number | null = null;
  let stopped = false;

  function tick(): void {
    if (stopped) return;
    analyser.getByteTimeDomainData(data);
    let sumSquares = 0;
    for (let i = 0; i < data.length; i++) {
      const normalized = (data[i]! - 128) / 128;
      sumSquares += normalized * normalized;
    }
    onAmplitudeChange(Math.sqrt(sumSquares / data.length));
    handle = raf(tick);
  }
  handle = raf(tick);

  return {
    stop(): void {
      if (stopped) return;
      stopped = true;
      if (handle !== null) caf(handle);
      handle = null;
      onAmplitudeChange(0);
    },
  };
}
