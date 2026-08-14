/**
 * Explicit-dispatch agent name — apps/agent registers under this name, and
 * apps/api's livekit-connect route requests it via CreateRoomRequest's
 * `agents` field. Shared here so the two separate processes can never drift
 * apart on this string, per docs/ARCHITECTURE.md §4's "explicit dispatch"
 * cost-control boundary — the worker fleet only ever receives jobs for
 * rooms apps/api intentionally created for a real Enterprise session.
 */
export const LIVEKIT_AGENT_NAME = "avatrain-livekit-agent";

/** LiveKit room-name prefix for a dashboard/voice-ai session's Mode B room. */
export const LIVEKIT_ROOM_PREFIX = "ts_";

export function liveKitRoomName(trainingSessionId: string): string {
  return `${LIVEKIT_ROOM_PREFIX}${trainingSessionId}`;
}
