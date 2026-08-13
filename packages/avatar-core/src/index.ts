export interface AvatarProviderStartConfig {
  replicaId: string;
  container: HTMLElement;
}

/**
 * Duplicated from packages/shared/src/tutor/emotion.ts's Emotion type rather
 * than imported — same reasoning vrm-color-map.ts documents for duplicating
 * SKIN_TONE_HEX instead of a live cross-package import: @avatrain/shared's
 * module graph pulls in heavy Node-only server dependencies that must never
 * end up in a browser bundle, and this package has no dependency on
 * @avatrain/shared at all today. Keep in sync by hand.
 */
export type AvatarEmotion = "happy" | "sad" | "surprised" | "neutral";

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
  /**
   * Optional — only VrmAvatarProvider implements this (Mock has no face by
   * design, Simli's face is vendor-driven). Crossfades the given emotion's
   * VRM expression preset for the current utterance.
   */
  setEmotion?(emotion: AvatarEmotion): void;
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
export * from "./vrm-rest-pose.js";
export * from "./vrm-material-tint.js";
export * from "./vrm-expression-driver.js";
export * from "./vrm-idle-animator.js";
export * from "./vrm-emotion-driver.js";
export * from "./vrm-avatar-provider.js";
export * from "./vrm-avatar-preview-renderer.js";
export * from "./avatar-provider-factory.js";
