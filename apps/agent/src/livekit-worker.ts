import {
  AudioStream,
  ParticipantKind,
  RoomEvent,
  TrackKind,
  type RemoteParticipant,
  type RemoteTrack,
} from "@livekit/rtc-node";
import { defineAgent, type JobContext } from "@livekit/agents";
import { loadAgentConfig } from "./config.js";
import { CostGateTimeoutError, waitForHumanParticipant } from "./cost-gate.js";
import { createJobHandler } from "./job-handler.js";
import { createAvatarRelay } from "./avatar-relay.js";
import { createTeardownWatcher, type TeardownReason } from "./teardown.js";
import { emitUsage } from "./metrics.js";

/**
 * The agent-definition module @livekit/agents' worker framework dynamically
 * imports per job — `index.ts`'s `ServerOptions.agent` points at this
 * file's path, not a function reference; the framework spawns a child
 * process per job and imports this module's default export there.
 * Necessarily thin, necessarily unverified by a unit test — every piece it
 * wires (cost-gate.ts, job-handler.ts, avatar-relay.ts, teardown.ts,
 * metrics.ts) is independently tested; this file is the
 * live-deployment-only glue, same class of risk B0/avatar-relay.ts's
 * defaultJoinSimliRoomAndRepublish already carries.
 */

interface RoomMetadata {
  orgId: string;
  trainingSessionId: string;
}

function parseRoomMetadata(metadata: string | undefined): RoomMetadata | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as Partial<RoomMetadata>;
    if (typeof parsed.orgId === "string" && typeof parsed.trainingSessionId === "string") {
      return { orgId: parsed.orgId, trainingSessionId: parsed.trainingSessionId };
    }
  } catch {
    // fall through to null
  }
  return null;
}

function isHumanParticipant(participant: RemoteParticipant): boolean {
  return participant.kind !== ParticipantKind.AGENT;
}

export const avatrainLiveKitAgent = defineAgent({
  entry: async (ctx: JobContext) => {
    const config = loadAgentConfig();
    await ctx.connect();

    const roomName = ctx.room.name ?? "unknown";
    const metadata = parseRoomMetadata(ctx.room.metadata);
    if (!metadata) {
      // Explicit dispatch (LIVEKIT_AGENT_NAME) means this worker is only
      // ever handed jobs for rooms apps/api itself created with well-formed
      // { orgId, trainingSessionId } metadata — unparseable metadata means
      // something is genuinely wrong (a room created outside that path, or
      // a protocol drift), not a case to paper over. A soft "unknown"
      // fallback here would let a paid conversation loop run with no real
      // org attached to its usage-emit, a billing-attribution gap a
      // security review flagged — hard-stop instead.
      console.error(`[livekit-worker] room "${roomName}" has unparseable/missing metadata — refusing to start`);
      ctx.shutdown("invalid_room_metadata");
      return;
    }
    const { orgId, trainingSessionId } = metadata; // re-narrowed as plain consts — a nested function declaration doesn't retain the outer `if (!metadata) return` narrowing on its own
    const startedAt = Date.now();

    function emit(reason: TeardownReason | "cost_gate_timeout"): void {
      emitUsage({
        trainingSessionId,
        orgId,
        roomName,
        billableMs: Math.max(0, Date.now() - startedAt),
        reason,
      });
    }

    // Cost gate — must resolve strictly before any paid provider (LLM/STT/
    // TTS/Simli) call fires. See job-handler.ts / avatar-relay.ts, both only
    // ever constructed below this line.
    try {
      await waitForHumanParticipant(ctx.room, config.AGENT_JOIN_TIMEOUT_MS);
    } catch (err) {
      if (err instanceof CostGateTimeoutError) {
        emit("cost_gate_timeout");
        ctx.shutdown("cost_gate_timeout");
        return;
      }
      throw err;
    }

    const agentParticipant = ctx.agent;
    if (!agentParticipant) {
      throw new Error("ctx.agent is undefined after ctx.connect() — cannot publish the avatar relay's tracks");
    }
    const relay = await createAvatarRelay({
      simliApiKey: config.SIMLI_API_KEY,
      simliFaceId: config.SIMLI_FACE_ID,
      ourLocalParticipant: agentParticipant,
      onError: (message) => console.error("[avatar-relay]", message),
    });

    const jobHandler = createJobHandler({
      onSentenceAudio: (audio) => relay.sendSentenceAudio(audio),
      onTranscript: () => {
        // Data-channel publish of transcript/turn events, validated through
        // packages/shared/src/realtime/ws-messages.ts's serverMessageSchema,
        // is dashboard-consumer work tracked separately (see B4's scope
        // flag in the implementation plan) — not wired here yet.
      },
      // Barge-in — flushes Simli's own playback queue the moment the human
      // starts talking over an in-flight reply. See job-handler.ts's
      // onBargeIn doc comment for why this is required, not optional.
      onBargeIn: () => relay.skip(),
      onError: (message) => console.error("[job-handler]", message),
    });

    const teardown = createTeardownWatcher({
      lastHumanGraceMs: config.LAST_HUMAN_GRACE_MS,
      idleTimeoutMs: config.AGENT_IDLE_TIMEOUT_MS,
      maxSessionMs: config.AGENT_MAX_SESSION_MS,
      onTeardown: async (reason) => {
        jobHandler.stop();
        await relay.stop();
        emit(reason);
        ctx.shutdown(reason);
      },
    });

    ctx.room.on(RoomEvent.ParticipantDisconnected, () => {
      const stillHasHuman = [...ctx.room.remoteParticipants.values()].some(isHumanParticipant);
      if (!stillHasHuman) teardown.onLastHumanLeft();
    });
    ctx.room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
      if (isHumanParticipant(participant)) teardown.onHumanRejoined();
    });

    function subscribeToParticipantAudio(participant: RemoteParticipant): void {
      if (!isHumanParticipant(participant)) return;
      for (const publication of participant.trackPublications.values()) {
        const track = publication.track;
        if (track && track.kind === TrackKind.KIND_AUDIO) void pumpAudio(track);
      }
    }
    async function pumpAudio(track: RemoteTrack): Promise<void> {
      const reader = new AudioStream(track).getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        teardown.recordActivity();
        jobHandler.pushAudioFrame(value.data, value.sampleRate);
      }
    }

    ctx.room.on(RoomEvent.TrackSubscribed, (_track, _publication, participant: RemoteParticipant) => {
      subscribeToParticipantAudio(participant);
    });
    for (const participant of ctx.room.remoteParticipants.values()) {
      subscribeToParticipantAudio(participant);
    }
  },
});

export default avatrainLiveKitAgent;
