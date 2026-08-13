import type { AvatarProvider, AvatarProviderStartConfig } from "./index.js";
import { loadVrmScene, type VrmSceneHandle, type LoadVrmSceneOptions } from "./vrm-loader.js";
import { applyMaterialTints } from "./vrm-material-tint.js";
import { createVrmExpressionDriver, type VrmExpressionDriver } from "./vrm-expression-driver.js";
import { vrmModelPath, placeholderVrmModelPath } from "./vrm-model-path.js";
import { startAudioAmplitudeLoop, type AudioAmplitudeLoopHandle } from "./audio-amplitude.js";
import { createMockAvatarProvider } from "./mock-avatar-provider.js";

export interface VrmAvatarProviderOptions {
  skinToneHex?: string | null;
  hairColorHex?: string | null;
  skinMaterialNameHints?: string[];
  hairMaterialNameHints?: string[];
  onSubtitleChange?: (text: string) => void;
  onAmplitudeChange?: (amplitude: number) => void;
  /** Injectable for tests; defaults to loadVrmScene (real GLTF fetch + WebGL). */
  loadScene?: (options: LoadVrmSceneOptions) => Promise<VrmSceneHandle>;
  createAudioElement?: () => HTMLAudioElement;
  createAudioContext?: () => AudioContext;
  createMediaStream?: (tracks: MediaStreamTrack[]) => MediaStream;
  requestAnimationFrame?: (callback: () => void) => number;
  cancelAnimationFrame?: (handle: number) => void;
  /**
   * Used if the VRM model (and its placeholder) both fail to load, or WebGL
   * is unavailable — defaults to createMockAvatarProvider(). The caller
   * never sees a rejected start(): a broken/missing 3D asset degrades to
   * the $0 idle-video renderer rather than crashing a training session.
   */
  fallbackProvider?: AvatarProvider;
}

/**
 * Real, free, open-source talking-avatar provider — the AvatarProvider-
 * shaped counterpart to MockAvatarProvider (no lip-sync, no customization)
 * and SimliAvatarProvider (real lip-sync, paid, gender-only face selection).
 * Renders a VRM model via Three.js (vrm-loader.ts), applies skin
 * tone/hair color as live material tints (vrm-material-tint.ts), and drives
 * a real-time mouth-open viseme from the speech amplitude signal
 * (vrm-expression-driver.ts) — the first provider where skin tone, hair
 * color, hairstyle, and outfit (via which base model loads) all actually
 * reach the rendered avatar. See avatar-provider-factory.ts for how
 * NEXT_PUBLIC_AVATAR_PROVIDER selects this.
 */
export function createVrmAvatarProvider(options: VrmAvatarProviderOptions = {}): AvatarProvider {
  const loadScene = options.loadScene ?? loadVrmScene;

  // Lazy — only constructed if the VRM model (and its placeholder) both
  // fail to load. The common case (VRM loads fine) never touches Mock's own
  // <video>/<audio> elements at all.
  let fallbackInstance: AvatarProvider | null = null;
  function getFallback(): AvatarProvider {
    if (!fallbackInstance) {
      fallbackInstance =
        options.fallbackProvider ??
        createMockAvatarProvider({
          onSubtitleChange: options.onSubtitleChange,
          onAmplitudeChange: options.onAmplitudeChange,
          requestAnimationFrame: options.requestAnimationFrame,
          cancelAnimationFrame: options.cancelAnimationFrame,
        });
    }
    return fallbackInstance;
  }

  const audioElement = options.createAudioElement?.() ?? document.createElement("audio");
  audioElement.autoplay = true;
  const createMediaStream = options.createMediaStream ?? ((tracks: MediaStreamTrack[]) => new MediaStream(tracks));

  const raf = (callback: () => void): number =>
    (options.requestAnimationFrame ?? globalThis.requestAnimationFrame)(callback);
  const caf = (handle: number): void => (options.cancelAnimationFrame ?? globalThis.cancelAnimationFrame)?.(handle);

  let usingFallback = false;
  let sceneHandle: VrmSceneHandle | null = null;
  let expressionDriver: VrmExpressionDriver | null = null;
  let audioContext: AudioContext | null = null;
  let sourceNode: { disconnect(): void } | null = null;
  let amplitudeLoop: AudioAmplitudeLoopHandle | null = null;
  let renderRafHandle: number | null = null;
  let mounted = false;

  function runRenderLoop(): void {
    const tick = (): void => {
      sceneHandle?.renderFrame();
      renderRafHandle = raf(tick);
    };
    renderRafHandle = raf(tick);
  }

  function stopRenderLoop(): void {
    if (renderRafHandle !== null) {
      caf(renderRafHandle);
      renderRafHandle = null;
    }
  }

  function stopAmplitudeLoop(): void {
    amplitudeLoop?.stop();
    amplitudeLoop = null;
    sourceNode?.disconnect();
    sourceNode = null;
  }

  async function startVrm(config: AvatarProviderStartConfig): Promise<void> {
    const primaryUrl = vrmModelPath(config.replicaId);
    let handle: VrmSceneHandle;
    try {
      handle = await loadScene({ modelUrl: primaryUrl, container: config.container });
    } catch (primaryError) {
      console.warn(`[vrm-avatar-provider] failed to load "${primaryUrl}", trying the placeholder model:`, primaryError);
      handle = await loadScene({ modelUrl: placeholderVrmModelPath(), container: config.container });
    }

    applyMaterialTints(handle.vrm, {
      skinToneHex: options.skinToneHex,
      hairColorHex: options.hairColorHex,
      skinMaterialNameHints: options.skinMaterialNameHints,
      hairMaterialNameHints: options.hairMaterialNameHints,
    });

    sceneHandle = handle;
    expressionDriver = createVrmExpressionDriver(handle.vrm);
    config.container.appendChild(audioElement);
    mounted = true;
    runRenderLoop();
  }

  return {
    async start(config: AvatarProviderStartConfig): Promise<void> {
      try {
        await startVrm(config);
      } catch (err) {
        console.error("[vrm-avatar-provider] no VRM model or placeholder could be loaded — falling back to Mock:", err);
        usingFallback = true;
        await getFallback().start(config);
      }
    },

    speak(audioTrack: MediaStreamTrack, subtitleText: string): void {
      if (usingFallback) {
        getFallback().speak(audioTrack, subtitleText);
        return;
      }
      audioElement.srcObject = createMediaStream([audioTrack]);
      options.onSubtitleChange?.(subtitleText);

      audioContext = options.createAudioContext?.() ?? new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      const newSource = audioContext.createMediaStreamSource(createMediaStream([audioTrack]));
      newSource.connect(analyser);
      sourceNode = newSource;

      amplitudeLoop?.stop();
      amplitudeLoop = startAudioAmplitudeLoop(
        analyser,
        (amplitude) => {
          expressionDriver?.setAmplitude(amplitude);
          options.onAmplitudeChange?.(amplitude);
        },
        { requestAnimationFrame: options.requestAnimationFrame, cancelAnimationFrame: options.cancelAnimationFrame },
      );
    },

    interrupt(): void {
      if (usingFallback) {
        getFallback().interrupt();
        return;
      }
      audioElement.pause();
      stopAmplitudeLoop();
      expressionDriver?.reset();
      options.onSubtitleChange?.("");
    },

    stop(): void {
      if (usingFallback) {
        getFallback().stop();
        usingFallback = false;
        return;
      }
      stopAmplitudeLoop();
      audioContext?.close();
      audioContext = null;
      stopRenderLoop();
      sceneHandle?.dispose();
      sceneHandle = null;
      expressionDriver = null;
      if (mounted) audioElement.remove();
      mounted = false;
    },

    get videoTrack(): MediaStreamTrack | null {
      // Renders to a local <canvas>, not a remote MediaStream — same as
      // MockAvatarProvider — unless the fallback (Mock) is active, in which
      // case its own (also always-null) videoTrack is authoritative.
      return usingFallback ? getFallback().videoTrack : null;
    },
  };
}
