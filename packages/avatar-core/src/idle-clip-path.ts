const PLACEHOLDER_PATH = "/avatars/idle/_placeholder.mp4";

/** Idle-loop clip for a resolved replica. May 404 until real footage is sourced — see replica-resolver.ts and mock-avatar-provider.ts's onerror fallback. */
export function idleClipPath(replicaId: string): string {
  return `/avatars/idle/${replicaId}.mp4`;
}

/** Single always-present fallback clip, per the brief's "use a placeholder clip if a file is missing, rather than blocking" (§5). */
export function placeholderClipPath(): string {
  return PLACEHOLDER_PATH;
}
