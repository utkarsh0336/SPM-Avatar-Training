import type { AvatarPreviewConfig, AvatarPreviewRenderer } from "./avatar-preview-renderer.js";
import { loadVrmScene, type VrmSceneHandle, type LoadVrmSceneOptions } from "./vrm-loader.js";
import { applyMaterialTints } from "./vrm-material-tint.js";
import { resolveReplicaId } from "./replica-resolver.js";
import { vrmModelPath, placeholderVrmModelPath } from "./vrm-model-path.js";
import { SKIN_TONE_HEX, HAIR_COLOR_HEX } from "./vrm-color-map.js";
import { createPlaceholderAvatarPreviewRenderer } from "./placeholder-avatar-preview-renderer.js";

export interface VrmAvatarPreviewRendererOptions {
  /** Injectable for tests; defaults to loadVrmScene. */
  loadScene?: (options: LoadVrmSceneOptions) => Promise<VrmSceneHandle>;
  requestAnimationFrame?: (callback: () => void) => number;
  cancelAnimationFrame?: (handle: number) => void;
  /** Used if the VRM model (and its placeholder) both fail to load — defaults to createPlaceholderAvatarPreviewRenderer(). */
  fallbackRenderer?: AvatarPreviewRenderer;
}

/**
 * The new default AvatarPreviewRenderer implementation, reusing the exact
 * same vrm-loader/vrm-material-tint modules as vrm-avatar-provider.ts (the
 * live session renderer) so a trainer's wizard preview and their actual
 * training session render the same VRM model with the same skin/hair
 * tints — not a separate, drifting preview pipeline. Static (no
 * speak()/lip-sync — this renders AvatarPreviewConfig, a configured-but-
 * not-in-session avatar, per avatar-preview-renderer.ts's own doc comment),
 * but still animated (idle spring-bone/breathing motion via the VRM's own
 * update loop) so it doesn't read as a frozen screenshot.
 */
export function createVrmAvatarPreviewRenderer(
  options: VrmAvatarPreviewRendererOptions = {},
): AvatarPreviewRenderer {
  const loadScene = options.loadScene ?? loadVrmScene;
  const raf = (callback: () => void): number =>
    (options.requestAnimationFrame ?? globalThis.requestAnimationFrame)(callback);
  const caf = (handle: number): void => (options.cancelAnimationFrame ?? globalThis.cancelAnimationFrame)?.(handle);

  let fallbackInstance: AvatarPreviewRenderer | null = null;
  function getFallback(): AvatarPreviewRenderer {
    if (!fallbackInstance) fallbackInstance = options.fallbackRenderer ?? createPlaceholderAvatarPreviewRenderer();
    return fallbackInstance;
  }

  let sceneHandle: VrmSceneHandle | null = null;
  let renderRafHandle: number | null = null;
  let usingFallback = false;
  let container: HTMLElement | null = null;
  let currentConfig: AvatarPreviewConfig | null = null;
  // Guards render()/update() racing an in-flight load — a fast series of
  // wizard picks (e.g. clicking through gender options quickly) must not
  // mount a stale model after a newer render() call has already started.
  let loadToken = 0;

  function stopRenderLoop(): void {
    if (renderRafHandle !== null) {
      caf(renderRafHandle);
      renderRafHandle = null;
    }
  }

  function runRenderLoop(): void {
    const tick = (): void => {
      sceneHandle?.renderFrame();
      renderRafHandle = raf(tick);
    };
    renderRafHandle = raf(tick);
  }

  function applyTints(config: AvatarPreviewConfig): void {
    if (!sceneHandle) return;
    applyMaterialTints(sceneHandle.vrm, {
      skinToneHex: SKIN_TONE_HEX[config.skinTone] ?? null,
      hairColorHex: HAIR_COLOR_HEX[config.hairColor] ?? null,
    });
  }

  async function loadFor(config: AvatarPreviewConfig, targetContainer: HTMLElement): Promise<void> {
    const myToken = ++loadToken;
    const replicaId = resolveReplicaId({
      style: config.style ?? "REALISTIC",
      gender: config.gender,
      outfit: config.outfit,
    });
    const primaryUrl = vrmModelPath(replicaId);

    let handle: VrmSceneHandle;
    try {
      handle = await loadScene({ modelUrl: primaryUrl, container: targetContainer });
    } catch (primaryError) {
      try {
        handle = await loadScene({ modelUrl: placeholderVrmModelPath(), container: targetContainer });
      } catch (placeholderError) {
        if (myToken !== loadToken) return; // superseded by a newer render()/update() call
        console.error(
          "[vrm-avatar-preview-renderer] no VRM model or placeholder could be loaded — falling back:",
          primaryError,
          placeholderError,
        );
        usingFallback = true;
        await getFallback().render(config, targetContainer);
        return;
      }
    }

    if (myToken !== loadToken) {
      handle.dispose();
      return;
    }

    sceneHandle?.dispose();
    stopRenderLoop();
    sceneHandle = handle;
    applyTints(config);
    runRenderLoop();
  }

  return {
    async render(config: AvatarPreviewConfig, targetContainer: HTMLElement): Promise<void> {
      container = targetContainer;
      currentConfig = config;
      await loadFor(config, targetContainer);
    },

    update(config: AvatarPreviewConfig): void {
      const previousConfig = currentConfig;
      currentConfig = config;
      if (usingFallback) {
        getFallback().update(config);
        return;
      }
      if (!container) return;
      // A gender/style/outfit change resolves to a different base model —
      // reload. A skin-tone/hair-color-only change just re-tints in place.
      const replicaId = resolveReplicaId({ style: config.style ?? "REALISTIC", gender: config.gender, outfit: config.outfit });
      const previousReplicaId =
        sceneHandle && previousConfig
          ? resolveReplicaId({ style: previousConfig.style ?? "REALISTIC", gender: previousConfig.gender, outfit: previousConfig.outfit })
          : null;
      if (sceneHandle && replicaId === previousReplicaId) {
        applyTints(config);
      } else {
        void loadFor(config, container);
      }
    },

    destroy(): void {
      loadToken++; // invalidate any in-flight load
      stopRenderLoop();
      sceneHandle?.dispose();
      sceneHandle = null;
      if (usingFallback) fallbackInstance?.destroy();
      usingFallback = false;
      container = null;
      currentConfig = null;
    },
  };
}
