const PLACEHOLDER_PATH = "/avatars/vrm/_placeholder.vrm";

/**
 * VRM model asset for a resolved replica — same naming convention as
 * idle-clip-path.ts's idleClipPath, so replica-resolver.ts's registry needs
 * no separate per-entry URL field. May 404 until real assets are sourced
 * (VRoid Studio-authored or otherwise clearly-licensed .vrm files — a
 * content workstream, not something this package can produce) — see
 * vrm-avatar-provider.ts's fallback-to-placeholder-then-Mock chain.
 */
export function vrmModelPath(replicaId: string): string {
  return `/avatars/vrm/${replicaId}.vrm`;
}

/** Single always-present fallback model, mirroring idle-clip-path.ts's placeholderClipPath(). */
export function placeholderVrmModelPath(): string {
  return PLACEHOLDER_PATH;
}
