import type { AvatarProvider, AvatarProviderStartConfig } from "./index.js";
import { idleClipPath, placeholderClipPath } from "./idle-clip-path.js";

export interface MockAvatarProviderOptions {
  onSubtitleChange?: (text: string) => void;
  onAmplitudeChange?: (amplitude: number) => void;
  /** Injectable for tests; defaults to document.createElement("video"). */
  createVideoElement?: () => HTMLVideoElement;
  /** Injectable for tests; defaults to document.createElement("audio"). */
  createAudioElement?: () => HTMLAudioElement;
  /** Injectable for tests; defaults to a real AudioContext. */
  createAudioContext?: () => AudioContext;
  /** Injectable for tests; defaults to `new MediaStream(tracks)`. */
  createMediaStream?: (tracks: MediaStreamTrack[]) => MediaStream;
  /** Injectable for tests; defaults to the browser's requestAnimationFrame. */
  requestAnimationFrame?: (callback: () => void) => number;
  cancelAnimationFrame?: (handle: number) => void;
}

/**
 * Phase 1 avatar renderer per .claude/specs/ai-avatar.md §5: a looping idle
 * video, a subtitle callback driven by the TTS text, and a simple
 * audio-amplitude indicator. No lip-sync — deliberate, not a gap.
 */
export function createMockAvatarProvider(options: MockAvatarProviderOptions = {}): AvatarProvider {
  const videoElement = options.createVideoElement?.() ?? document.createElement("video");
  videoElement.loop = true;
  videoElement.muted = true;
  videoElement.autoplay = true;
  videoElement.playsInline = true;
  videoElement.style.width = "100%";
  videoElement.style.height = "100%";
  videoElement.style.objectFit = "cover";
  // Falls back to a single always-present placeholder clip rather than
  // blocking on real footage still being sourced (brief §5) — the same
  // idea as CameraPreview.tsx's <img onError>, ported to <video>'s native
  // error event since this is imperative DOM, not a React component.
  videoElement.addEventListener("error", () => {
    if (videoElement.src.endsWith(placeholderClipPath())) return;
    videoElement.src = placeholderClipPath();
    videoElement.load();
    videoElement.play().catch(() => {});
  });

  const audioElement = options.createAudioElement?.() ?? document.createElement("audio");
  audioElement.autoplay = true;

  // Resolved lazily via globalThis (a safe property access, never a
  // ReferenceError) rather than bound eagerly at factory-creation time —
  // start()/stop() never touch these, so a test that never calls speak()
  // should never need requestAnimationFrame to exist at all (it doesn't in
  // the plain Node vitest environment this package's tests run under).
  const raf = (callback: () => void): number =>
    (options.requestAnimationFrame ?? globalThis.requestAnimationFrame)(callback);
  const caf = (handle: number): void =>
    (options.cancelAnimationFrame ?? globalThis.cancelAnimationFrame)?.(handle);
  const createMediaStream = options.createMediaStream ?? ((tracks: MediaStreamTrack[]) => new MediaStream(tracks));

  let container: HTMLElement | null = null;
  let mounted = false;
  let audioContext: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let sourceNode: { disconnect(): void } | null = null;
  let amplitudeRafHandle: number | null = null;

  function stopAmplitudeLoop(): void {
    if (amplitudeRafHandle !== null) {
      caf(amplitudeRafHandle);
      amplitudeRafHandle = null;
    }
    sourceNode?.disconnect();
    sourceNode = null;
    analyser = null;
    options.onAmplitudeChange?.(0);
  }

  function runAmplitudeLoop(activeAnalyser: AnalyserNode): void {
    const data = new Uint8Array(activeAnalyser.frequencyBinCount);
    const tick = () => {
      if (!analyser) return;
      analyser.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (let i = 0; i < data.length; i++) {
        const normalized = (data[i]! - 128) / 128;
        sumSquares += normalized * normalized;
      }
      options.onAmplitudeChange?.(Math.sqrt(sumSquares / data.length));
      amplitudeRafHandle = raf(tick);
    };
    amplitudeRafHandle = raf(tick);
  }

  return {
    async start(config: AvatarProviderStartConfig): Promise<void> {
      container = config.container;
      videoElement.src = idleClipPath(config.replicaId);
      container.appendChild(videoElement);
      container.appendChild(audioElement);
      mounted = true;
      await videoElement.play().catch(() => {
        // Autoplay can still be rejected in some embedding contexts even
        // when muted+loop — not fatal; the idle frame is acceptable static
        // state until a user gesture unlocks playback.
      });
    },

    speak(audioTrack: MediaStreamTrack, subtitleText: string): void {
      audioElement.srcObject = createMediaStream([audioTrack]);
      options.onSubtitleChange?.(subtitleText);

      audioContext = options.createAudioContext?.() ?? new AudioContext();
      const newAnalyser = audioContext.createAnalyser();
      newAnalyser.fftSize = 2048;
      const newSource = audioContext.createMediaStreamSource(createMediaStream([audioTrack]));
      newSource.connect(newAnalyser);

      analyser = newAnalyser;
      sourceNode = newSource;
      runAmplitudeLoop(newAnalyser);
    },

    interrupt(): void {
      audioElement.pause();
      stopAmplitudeLoop();
      options.onSubtitleChange?.("");
    },

    stop(): void {
      stopAmplitudeLoop();
      audioContext?.close();
      audioContext = null;
      if (mounted && container) {
        videoElement.remove();
        audioElement.remove();
      }
      mounted = false;
      container = null;
    },

    videoTrack: null,
  };
}
