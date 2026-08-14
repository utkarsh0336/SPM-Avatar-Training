import { PARTICIPANT_KIND_AGENT, type ParticipantLike, type RoomParticipantSource } from "./room-types.js";

export class CostGateTimeoutError extends Error {
  constructor() {
    super("No human participant joined before the cost-gate timeout");
    this.name = "CostGateTimeoutError";
  }
}

function isHuman(participant: ParticipantLike): boolean {
  return participant.kind !== PARTICIPANT_KIND_AGENT;
}

/**
 * The literal "wait for a non-agent participant" cost-control step from
 * docs/ARCHITECTURE.md §4 — must resolve strictly before any paid provider
 * (LLM/STT/TTS/Simli) call fires, per job-handler.ts's own ordering.
 * Checks already-present participants first (join race — a human may
 * already be in the room by the time this job starts), then subscribes to
 * future joins, rejecting with CostGateTimeoutError if none arrives within
 * `timeoutMs`.
 */
export async function waitForHumanParticipant(
  room: RoomParticipantSource,
  timeoutMs: number,
): Promise<ParticipantLike> {
  for (const participant of room.remoteParticipants.values()) {
    if (isHuman(participant)) return participant;
  }

  return new Promise((resolve, reject) => {
    const onParticipantConnected = (participant: ParticipantLike): void => {
      if (!isHuman(participant)) return;
      cleanup();
      resolve(participant);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new CostGateTimeoutError());
    }, timeoutMs);
    function cleanup(): void {
      clearTimeout(timer);
      room.off("participantConnected", onParticipantConnected);
    }
    room.on("participantConnected", onParticipantConnected);
  });
}
