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

export interface AudioSpectrumBands {
  /** 0..1 average energy in the low frequency band. */
  low: number;
  /** 0..1 average energy in the mid frequency band. */
  mid: number;
  /** 0..1 average energy in the high frequency band. */
  high: number;
  /** 0..~1 RMS amplitude — the same signal startAudioAmplitudeLoop computes. */
  amplitude: number;
}

export interface AudioSpectrumLoopHandle {
  /** Cancels the loop and reports final bands of all-zero. */
  stop(): void;
}

/**
 * Sibling to startAudioAmplitudeLoop, for vrm-avatar-provider.ts's multi-
 * viseme lip-sync (vrm-expression-driver.ts's setSpectrum) — deliberately a
 * SEPARATE function rather than extending startAudioAmplitudeLoop itself,
 * since mock-avatar-provider.ts uses that one as-is for its simple UI pulse
 * and must not have to pay for (or depend on) frequency-band analysis it
 * doesn't need. Band edges are fractions of frequencyBinCount rather than
 * literal Hz values, so this works correctly regardless of the
 * AudioContext's actual sample rate — at a typical 48kHz TTS sample rate
 * these roughly correspond to low <500Hz, mid 500-2500Hz, high 2500-6000Hz.
 */
export function startAudioSpectrumLoop(
  analyser: AnalyserNode,
  onSpectrumChange: (bands: AudioSpectrumBands) => void,
  options: AudioAmplitudeLoopOptions = {},
): AudioSpectrumLoopHandle {
  const raf = (callback: () => void): number =>
    (options.requestAnimationFrame ?? globalThis.requestAnimationFrame)(callback);
  const caf = (handle: number): void => (options.cancelAnimationFrame ?? globalThis.cancelAnimationFrame)?.(handle);

  const timeData = new Uint8Array(analyser.frequencyBinCount);
  const freqData = new Uint8Array(analyser.frequencyBinCount);
  const binCount = analyser.frequencyBinCount;
  const lowEnd = Math.max(1, Math.round(binCount * 0.05));
  const midEnd = Math.max(lowEnd + 1, Math.round(binCount * 0.25));
  const highEnd = Math.max(midEnd + 1, Math.round(binCount * 0.5));

  let handle: number | null = null;
  let stopped = false;

  // Reused across every tick and mutated in place rather than allocating a
  // fresh object per rAF call — this loop runs for the full duration of
  // every spoken utterance, up to 60Hz. Safe because startAudioSpectrumLoop
  // has exactly one consumer (vrm-avatar-provider.ts's speak() callback),
  // which reads the fields synchronously and never stores the reference.
  const bands = { low: 0, mid: 0, high: 0, amplitude: 0 };

  function bandAverage(data: Uint8Array, start: number, end: number): number {
    let sum = 0;
    for (let i = start; i < end; i++) sum += data[i]!;
    return sum / Math.max(1, end - start) / 255;
  }

  function tick(): void {
    if (stopped) return;

    analyser.getByteTimeDomainData(timeData);
    let sumSquares = 0;
    for (let i = 0; i < timeData.length; i++) {
      const normalized = (timeData[i]! - 128) / 128;
      sumSquares += normalized * normalized;
    }

    analyser.getByteFrequencyData(freqData);
    bands.low = bandAverage(freqData, 0, lowEnd);
    bands.mid = bandAverage(freqData, lowEnd, midEnd);
    bands.high = bandAverage(freqData, midEnd, highEnd);
    bands.amplitude = Math.sqrt(sumSquares / timeData.length);

    onSpectrumChange(bands);
    handle = raf(tick);
  }
  handle = raf(tick);

  return {
    stop(): void {
      if (stopped) return;
      stopped = true;
      if (handle !== null) caf(handle);
      handle = null;
      bands.low = 0;
      bands.mid = 0;
      bands.high = 0;
      bands.amplitude = 0;
      onSpectrumChange(bands);
    },
  };
}
