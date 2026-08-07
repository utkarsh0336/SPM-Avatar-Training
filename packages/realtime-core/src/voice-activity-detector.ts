export interface VoiceActivityDetectorOptions {
  micTrack: MediaStreamTrack;
  /** RMS level (0-1) above which audio counts as speech. */
  silenceThreshold?: number;
  /**
   * How long RMS must stay below the threshold before speech is
   * considered ended. Every turn pays this in full as dead time before
   * transcription even starts, often more than the Gemini+ElevenLabs round
   * trip combined — this default (700ms) is a reasoned starting point
   * (common range for turn-taking VAD), not a benchmarked one; tune it
   * with `pnpm bench:latency` against real audio once credentials exist,
   * trading against how often it cuts someone off mid-sentence.
   */
  silenceDurationMs?: number;
  /** Minimum speech duration before silence is allowed to end it — avoids a
   *  brief mic pop/breath being treated as a full turn. */
  minSpeechDurationMs?: number;
  onSpeechStart: () => void;
  onSpeechEnd: () => void;
  /** Injectable for tests; defaults to a real AudioContext. */
  createAudioContext?: () => AudioContext;
  /** Injectable for tests; defaults to the browser's requestAnimationFrame. */
  requestAnimationFrame?: (callback: () => void) => number;
}

export interface VoiceActivityDetector {
  stop(): void;
}

/**
 * Client-side voice activity detection for the turn-based voice loop —
 * OpenAI Realtime's server-side VAD (input_audio_buffer.speech_started/
 * stopped) doesn't exist in this free-tier pipeline, so this replaces it.
 * Volume is computed on a requestAnimationFrame loop, not inside an actual
 * audio callback, keeping with this repo's "nothing new in the audio
 * callback" principle (.claude/rules/realtime.md) even though that rule
 * file was written for the OpenAI leg this pipeline no longer has.
 */
export function startVoiceActivityDetector(
  options: VoiceActivityDetectorOptions,
): VoiceActivityDetector {
  const audioContext = options.createAudioContext?.() ?? new AudioContext();
  const source = audioContext.createMediaStreamSource(new MediaStream([options.micTrack]));
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);

  const data = new Uint8Array(analyser.frequencyBinCount);
  const silenceThreshold = options.silenceThreshold ?? 0.02;
  const silenceDurationMs = options.silenceDurationMs ?? 700;
  const minSpeechDurationMs = options.minSpeechDurationMs ?? 300;
  const raf = options.requestAnimationFrame ?? requestAnimationFrame;

  let speaking = false;
  let speechStartedAt = 0;
  let silenceStartedAt: number | null = null;
  let stopped = false;

  function computeRms(): number {
    analyser.getByteTimeDomainData(data);
    let sumSquares = 0;
    for (let i = 0; i < data.length; i++) {
      const normalized = (data[i]! - 128) / 128;
      sumSquares += normalized * normalized;
    }
    return Math.sqrt(sumSquares / data.length);
  }

  function tick(): void {
    if (stopped) return;
    const rms = computeRms();
    const now = Date.now();

    if (rms > silenceThreshold) {
      silenceStartedAt = null;
      if (!speaking) {
        speaking = true;
        speechStartedAt = now;
        options.onSpeechStart();
      }
    } else if (speaking) {
      if (silenceStartedAt === null) silenceStartedAt = now;
      const speechDuration = now - speechStartedAt;
      const silenceDuration = now - silenceStartedAt;
      if (speechDuration >= minSpeechDurationMs && silenceDuration >= silenceDurationMs) {
        speaking = false;
        silenceStartedAt = null;
        options.onSpeechEnd();
      }
    }

    raf(tick);
  }

  raf(tick);

  return {
    stop: () => {
      stopped = true;
      source.disconnect();
      analyser.disconnect();
    },
  };
}
