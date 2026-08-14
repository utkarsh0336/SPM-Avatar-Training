"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import {
  createAvatarProviderFromEnv,
  resolveReplicaId,
  SKIN_TONE_HEX,
  HAIR_COLOR_HEX,
  type AvatarProvider,
} from "@avatrain/avatar-core";
import { connectConversationSession, type ConversationSessionStatus } from "@avatrain/realtime-core";
import type { AvatarStyle, Gender, Outfit, Expertise, VoiceTone } from "@avatrain/shared/tutor";
import type { AvatarRecord } from "@avatrain/shared/avatar";
import { getAvatar, getMyAvatars, mintConversationTicket, mintSimliSession } from "../../../lib/api-client";
import { tryConnectLiveKitAvatar, type LiveKitAvatarConnection } from "../../../lib/livekit-avatar-connect";

export interface ConversationMessage {
  id: string;
  role: "AVATAR" | "USER";
  text: string;
}

interface UseConversationSessionOptions {
  trainingSessionId: string;
  topic: string;
  containerRef: RefObject<HTMLDivElement>;
  muted: boolean;
  /** The persona picked in NewSessionModal.tsx (session.avatarId) — when set, fetches that specific avatar instead of defaulting to the caller's own ACTIVE-first avatar. */
  avatarId?: string | null;
}

interface UseConversationSessionResult {
  status: ConversationSessionStatus;
  messages: ConversationMessage[];
  pendingTurn: boolean;
  captionText: string;
  amplitude: number;
  /** True once the Mode B (LiveKit/photoreal) avatar path is live for this session — drives the Photoreal badge. */
  usingLiveKit: boolean;
}

interface ResolvedPersona {
  avatarId: string | null;
  name: string;
  style: AvatarStyle;
  gender: Gender;
  skinTone: string;
  hairStyle: string;
  hairColor: string;
  outfit: Outfit;
  expertise: Expertise;
  voice: VoiceTone;
}

// Used whenever the trainer opens a session without having completed
// onboarding yet, or GET /v1/avatars/mine returns no rows (e.g. it 401s
// mid-session-start) — never hard-fails a session. Also backfills any
// individual field a DRAFT avatar left null (onboarding.md's fields are all
// nullable until POST /complete requires them).
const DEFAULT_PERSONA: ResolvedPersona = {
  avatarId: null,
  style: "REALISTIC",
  gender: "FEMALE",
  skinTone: "TONE_2",
  hairStyle: "MEDIUM",
  hairColor: "AUBURN",
  outfit: "BUSINESS_FORMAL",
  name: "My Avatar",
  expertise: "HR_LEAVE_POLICY",
  voice: "NEUTRAL",
};

/**
 * Resolves the caller's persona from the persisted Avatar record (ACTIVE
 * preferred, per avatar-service.ts's getMyAvatars ordering) rather than the
 * old localStorage onboarding handoff — closes
 * .claude/specs/avatar-builder-customization.md's Implementation
 * Assumptions #5 ("an explicit, separate follow-up"). Falls back to
 * DEFAULT_PERSONA wholesale on any fetch failure, and backfills individual
 * null fields from it otherwise — a DRAFT-status record can have every
 * customization field still unset.
 */
function resolvePersona(record: AvatarRecord | undefined): ResolvedPersona {
  if (!record) return DEFAULT_PERSONA;
  return {
    avatarId: record.id,
    name: record.name || DEFAULT_PERSONA.name,
    style: record.style ?? DEFAULT_PERSONA.style,
    gender: record.gender ?? DEFAULT_PERSONA.gender,
    skinTone: record.skinTone ?? DEFAULT_PERSONA.skinTone,
    hairStyle: record.hairStyle ?? DEFAULT_PERSONA.hairStyle,
    hairColor: record.hairColor ?? DEFAULT_PERSONA.hairColor,
    outfit: record.outfit ?? DEFAULT_PERSONA.outfit,
    expertise: record.expertise ?? DEFAULT_PERSONA.expertise,
    voice: record.voice ?? DEFAULT_PERSONA.voice,
  };
}

const DEFAULT_WS_BASE = "ws://localhost:4000";

/**
 * Connects the live conversation pipeline per .claude/specs/ai-avatar.md:
 * resolves the trainer's avatar persona from the onboarding handoff (or a
 * default), mounts the Mock avatar provider, mints a WS ticket, and wires
 * packages/realtime-core's connectConversationSession to it. Replaces the
 * old useVoiceAvatarSession.ts (Gemini+ElevenLabs+Simli demo).
 */
export function useConversationSession({
  trainingSessionId,
  topic,
  containerRef,
  muted,
  avatarId,
}: UseConversationSessionOptions): UseConversationSessionResult {
  const [status, setStatus] = useState<ConversationSessionStatus>("connecting");
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [captionText, setCaptionText] = useState("");
  const [amplitude, setAmplitude] = useState(0);
  const [usingLiveKit, setUsingLiveKit] = useState(false);
  const micTrackRef = useRef<MediaStreamTrack | null>(null);
  const mutedRef = useRef(muted);
  const liveKitConnectionRef = useRef<LiveKitAvatarConnection | null>(null);

  useEffect(() => {
    mutedRef.current = muted;
    if (micTrackRef.current) micTrackRef.current.enabled = !muted;
    void liveKitConnectionRef.current?.room.localParticipant.setMicrophoneEnabled(!muted);
  }, [muted]);

  useEffect(() => {
    let cancelled = false;
    let handle: { disconnect(): void } | null = null;
    let avatarProvider: AvatarProvider | null = null;
    let liveKitConnection: LiveKitAvatarConnection | null = null;

    async function start(): Promise<void> {
      const container = containerRef.current;
      if (!container) return;

      // Mode B (LiveKit/photoreal) attempt first — succeeds only for an
      // Enterprise-plan org with the feature flag on; any failure is
      // expected (the default path for every other org) and falls straight
      // through to the existing VRM/Mock/Simli flow below, unchanged.
      const liveKit = await tryConnectLiveKitAvatar(trainingSessionId, container);
      if (cancelled) {
        liveKit?.disconnect();
        return;
      }
      if (liveKit) {
        liveKitConnection = liveKit;
        liveKitConnectionRef.current = liveKit;
        await liveKit.room.localParticipant.setMicrophoneEnabled(!mutedRef.current);
        setUsingLiveKit(true);
        setStatus("listening");
        return;
      }

      // Fetch, not localStorage — the persisted Avatar record is the source
      // of truth for a live session's persona now (see resolvePersona's doc
      // comment). Never hard-fails a session on a fetch error. When the
      // session was created with an explicit avatarId (NewSessionModal.tsx's
      // picker, shown once an org has more than one avatar), fetch that
      // specific persona instead of defaulting to the caller's own
      // ACTIVE-first avatar — a trainer must be able to run a session as a
      // colleague's persona, not only their own.
      const record = avatarId
        ? await getAvatar(avatarId).catch(() => undefined)
        : await getMyAvatars()
            .then((result) => result.avatars[0])
            .catch(() => undefined as AvatarRecord | undefined);
      const persona = resolvePersona(record);
      const replicaId = resolveReplicaId({ style: persona.style, gender: persona.gender, outfit: persona.outfit });

      // The effect's cleanup below can fire while the persona fetch above is
      // still in flight (React StrictMode's dev-only double-invoke, or a
      // real dependency change) — without this check, a stale invocation
      // still creates and starts its own avatarProvider after the "current"
      // one has already been torn down, mounting a second VRM canvas/audio
      // element into the same container that nothing ever disposes (the
      // outer avatarProvider variable this closure's cleanup calls stop()
      // on is still null at that point, since it isn't assigned until
      // right below).
      if (cancelled) return;

      avatarProvider = createAvatarProviderFromEnv({
        // Literal process.env.NEXT_PUBLIC_* access, required so Next.js can
        // statically inline it into the client bundle — see
        // avatar-provider-factory.ts's env option doc comment.
        env: { NEXT_PUBLIC_AVATAR_PROVIDER: process.env.NEXT_PUBLIC_AVATAR_PROVIDER },
        getSimliSessionCredentials: mintSimliSession,
        skinToneHex: SKIN_TONE_HEX[persona.skinTone] ?? null,
        hairColorHex: HAIR_COLOR_HEX[persona.hairColor] ?? null,
        onSubtitleChange: (text) => {
          if (!cancelled) setCaptionText(text);
        },
        onAmplitudeChange: (value) => {
          if (!cancelled) setAmplitude(value);
        },
      });

      try {
        await avatarProvider.start({ replicaId, container });

        // Mic permission and the ticket mint have no data dependency on
        // each other — run them concurrently.
        const [micStream, ticketResult] = await Promise.all([
          // Native browser DSP, requested explicitly rather than left to
          // user-agent defaults — see .claude/specs/voice-quality-latency-enforcement.md.
          navigator.mediaDevices.getUserMedia({
            audio: { noiseSuppression: true, echoCancellation: true, autoGainControl: true },
          }),
          mintConversationTicket(),
        ]);
        const micTrack = micStream.getAudioTracks()[0];
        if (!micTrack) throw new Error("no_microphone_track");
        if (cancelled) {
          micTrack.stop();
          return;
        }
        micTrack.enabled = !mutedRef.current;
        micTrackRef.current = micTrack;

        const wsBase = process.env.NEXT_PUBLIC_API_WS_URL ?? DEFAULT_WS_BASE;
        const wsUrl = `${wsBase}/v1/conversations/${trainingSessionId}/ws?ticket=${encodeURIComponent(ticketResult.ticket)}`;

        handle = await connectConversationSession({
          wsUrl,
          micTrack,
          avatar: avatarProvider,
          sessionConfig: {
            avatarName: persona.name || "My Avatar",
            expertise: persona.expertise,
            voiceTone: persona.voice,
            style: persona.style,
            gender: persona.gender,
            outfit: persona.outfit,
            topic,
            // ControlBar's Language control is pure UI state, not wired to
            // this session (see ControlBar.tsx's doc comment) — English is
            // the only language actually implemented end-to-end so far (see
            // Voice AI's useVoiceConversationSession.ts).
            language: "English",
            // Now actually sent (was reserved-but-unused) — this is what
            // activates conversation-service.ts's curriculum/checkpoint tool
            // loop for a real training session, not just DEFAULT_PERSONA's
            // no-curriculum fallback path.
            avatarId: persona.avatarId ?? undefined,
          },
          onStatusChange: (next) => {
            if (!cancelled) setStatus(next);
          },
          onTranscript: (entry) => {
            if (cancelled) return;
            setMessages((prev) => [
              ...prev,
              { id: `${entry.utteranceId}-${entry.role}`, role: entry.role === "user" ? "USER" : "AVATAR", text: entry.text },
            ]);
          },
          // Checkpoint/grading feedback — see
          // .claude/specs/interactive-assessment.md's UI Changes. Rendered
          // as synthetic AVATAR-role transcript entries rather than a
          // separate UI surface, deliberately staying inside
          // ConversationMessage's existing {id, role, text} shape so
          // TranscriptPanel/TranscriptBubble need no changes — a richer,
          // visually distinct treatment is a natural follow-up, not part of
          // this pass. Only fires when sessionConfig.avatarId resolves to
          // an avatar with a Curriculum attached — conversation-service.ts
          // loads it server-side and is a no-op otherwise (e.g. DEFAULT_PERSONA's
          // avatarId: null, or a persona with no Curriculum yet).
          onCheckpointStarted: (event) => {
            if (cancelled) return;
            setMessages((prev) => [
              ...prev,
              { id: `checkpoint-started-${event.objectiveId}-${prev.length}`, role: "AVATAR", text: `Checking understanding: ${event.objectiveTitle}` },
            ]);
          },
          onCheckpointResult: (event) => {
            if (cancelled) return;
            const verdictLabel = event.verdict === "PASS" ? "✓ Correct" : "Try again";
            setMessages((prev) => [
              ...prev,
              {
                id: `checkpoint-result-${event.objectiveId}-${event.attempts}`,
                role: "AVATAR",
                text: `${verdictLabel} — ${event.feedback}`,
              },
            ]);
          },
          onModuleCompleted: (event) => {
            if (cancelled) return;
            setMessages((prev) => [
              ...prev,
              { id: `module-completed-${event.curriculumId}`, role: "AVATAR", text: "🎉 Module complete — every objective passed." },
            ]);
          },
          onError: (message) => {
            console.error("[useConversationSession] turn error:", message);
          },
        });
      } catch (err) {
        console.error("[useConversationSession] failed to connect:", err);
        if (!cancelled) setStatus("error");
      }
    }

    start();

    return () => {
      cancelled = true;
      handle?.disconnect();
      micTrackRef.current?.stop();
      micTrackRef.current = null;
      avatarProvider?.stop();
      liveKitConnection?.disconnect();
      liveKitConnectionRef.current = null;
    };
  }, [trainingSessionId, topic, containerRef, avatarId]);

  return { status, messages, pendingTurn: status === "thinking", captionText, amplitude, usingLiveKit };
}
