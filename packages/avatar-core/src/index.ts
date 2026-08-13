export interface AvatarProviderStartConfig {
  replicaId: string;
  container: HTMLElement;
}

/**
 * The provider interface from .claude/specs/ai-avatar.md §4 — the app codes
 * against this only. Phase 1 (this pass) ships MockAvatarProvider only;
 * Tavus/HeyGen (Phase 2) and a self-hosted lip-sync service (Phase 3) are
 * adapters against this same interface, gated behind AVATAR_PROVIDER and
 * not built out yet. Client-side only (no secrets) — unlike LLM/STT/TTS,
 * this does not live in packages/shared.
 */
export interface AvatarProvider {
  start(config: AvatarProviderStartConfig): Promise<void>;
  /** Local playback of one turn's synthesized audio plus its subtitle text — no network. */
  speak(audioTrack: MediaStreamTrack, subtitleText: string): void;
  /** Barge-in: stop local playback immediately. */
  interrupt(): void;
  stop(): void;
  /** null for MockAvatarProvider — a local looping <video>, not a remote track. */
  readonly videoTrack: MediaStreamTrack | null;
}

export * from "./mock-avatar-provider.js";
export * from "./replica-resolver.js";
export * from "./idle-clip-path.js";
export * from "./avatar-preview-renderer.js";
export * from "./placeholder-avatar-preview-renderer.js";
export * from "./simli-avatar-provider.js";
export * from "./audio-amplitude.js";
export * from "./vrm-color-map.js";
export * from "./vrm-model-path.js";
export * from "./vrm-loader.js";
export * from "./vrm-material-tint.js";
export * from "./vrm-expression-driver.js";
export * from "./vrm-avatar-provider.js";
export * from "./vrm-avatar-preview-renderer.js";
export * from "./avatar-provider-factory.js";
