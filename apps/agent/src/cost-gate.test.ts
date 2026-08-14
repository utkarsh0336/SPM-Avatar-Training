import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CostGateTimeoutError, waitForHumanParticipant } from "./cost-gate.js";
import { PARTICIPANT_KIND_AGENT, type ParticipantLike, type RoomParticipantSource } from "./room-types.js";

const STANDARD = 0;

function createFakeRoom(initial: ParticipantLike[] = []): RoomParticipantSource & {
  emitParticipantConnected: (p: ParticipantLike) => void;
  listenerCount: () => number;
} {
  const remoteParticipants = new Map(initial.map((p) => [p.identity, p]));
  const listeners = new Set<(p: ParticipantLike) => void>();
  return {
    remoteParticipants,
    on: (_event, listener) => listeners.add(listener),
    off: (_event, listener) => listeners.delete(listener),
    emitParticipantConnected: (p) => listeners.forEach((l) => l(p)),
    listenerCount: () => listeners.size,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("waitForHumanParticipant", () => {
  it("resolves immediately from an already-present human participant (join race)", async () => {
    const room = createFakeRoom([{ identity: "learner-1", kind: STANDARD }]);
    await expect(waitForHumanParticipant(room, 5000)).resolves.toEqual({ identity: "learner-1", kind: STANDARD });
  });

  it("does not resolve from an already-present agent-kind participant", async () => {
    const room = createFakeRoom([{ identity: "our-own-agent", kind: PARTICIPANT_KIND_AGENT }]);
    const promise = waitForHumanParticipant(room, 5000);

    // Attach the rejection assertion BEFORE advancing timers — a promise
    // that rejects with no attached handler yet is flagged as an unhandled
    // rejection even if awaited on the very next line.
    const assertion = expect(promise).rejects.toBeInstanceOf(CostGateTimeoutError);
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });

  it("resolves once a human joins after the wait starts", async () => {
    const room = createFakeRoom();
    const promise = waitForHumanParticipant(room, 5000);

    room.emitParticipantConnected({ identity: "agent-joins-first", kind: PARTICIPANT_KIND_AGENT });
    room.emitParticipantConnected({ identity: "learner-2", kind: STANDARD });

    await expect(promise).resolves.toEqual({ identity: "learner-2", kind: STANDARD });
  });

  it("rejects with CostGateTimeoutError if no human ever joins", async () => {
    const room = createFakeRoom();
    const promise = waitForHumanParticipant(room, 5000);

    const assertion = expect(promise).rejects.toBeInstanceOf(CostGateTimeoutError);
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });

  it("removes its listener on both resolve and reject — no leak across jobs", async () => {
    const resolvingRoom = createFakeRoom();
    const resolvePromise = waitForHumanParticipant(resolvingRoom, 5000);
    resolvingRoom.emitParticipantConnected({ identity: "learner-3", kind: STANDARD });
    await resolvePromise;
    expect(resolvingRoom.listenerCount()).toBe(0);

    const rejectingRoom = createFakeRoom();
    const rejectPromise = waitForHumanParticipant(rejectingRoom, 5000);
    const assertion = expect(rejectPromise).rejects.toBeInstanceOf(CostGateTimeoutError);
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    expect(rejectingRoom.listenerCount()).toBe(0);
  });
});
