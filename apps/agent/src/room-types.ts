/**
 * Minimal structural subset of @livekit/rtc-node's Participant/Room —
 * declared locally rather than imported so cost-gate.ts (and its tests) stay
 * decoupled from a live LiveKit connection, same decoupling reasoning
 * packages/realtime-core/src/conversation-session.ts already documents for
 * its own ConversationAvatarSink. The real `Room`/`RemoteParticipant`
 * classes satisfy these structurally — no adapter needed at the call site.
 */
export interface ParticipantLike {
  identity: string;
  kind: number;
}

export interface RoomParticipantSource {
  remoteParticipants: Map<string, ParticipantLike>;
  on(event: "participantConnected", listener: (participant: ParticipantLike) => void): unknown;
  off(event: "participantConnected", listener: (participant: ParticipantLike) => void): unknown;
}

/**
 * Numeric value of @livekit/rtc-ffi-bindings's `ParticipantKind.AGENT`
 * (confirmed against the installed package: STANDARD=0, INGRESS=1,
 * EGRESS=2, SIP=3, AGENT=4, CONNECTOR=5, BRIDGE=6). Duplicated as a plain
 * constant rather than importing the real enum, for the same decoupling
 * reason as the interfaces above.
 */
export const PARTICIPANT_KIND_AGENT = 4;
