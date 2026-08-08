/**
 * A third, distinct concern from AvatarProvider (live talking-video during a
 * real session) and the spec'd StreamAvatarRenderer (LiveKit-video-backed) —
 * this renders a static/reactive preview of a *configured but not-yet-in-
 * session* avatar. See .claude/specs/avatar-builder-customization.md §3.
 *
 * The onboarding wizard's own AvatarPreviewPanel deliberately does NOT
 * import this — it stays decoupled from the runtime rendering pipeline, the
 * same rule already applied to LivePreviewPanel (onboarding.md). This seam
 * exists for other, future, non-onboarding consumers (an avatar list/detail
 * view, a rehearsal screen) that want to reuse one rendering adapter set
 * instead of each surface reinventing it.
 */
export interface AvatarPreviewConfig {
  style: string | null;
  gender: string;
  skinTone: string;
  hairStyle: string;
  hairColor: string;
  outfit: string;
  previewProvider: "NONE" | "READY_PLAYER_ME";
  avatarModelUrl: string | null;
  avatarSnapshotUrl: string | null;
}

export interface AvatarPreviewRenderer {
  render(config: AvatarPreviewConfig, container: HTMLElement): Promise<void>;
  update(config: AvatarPreviewConfig): void;
  destroy(): void;
}
