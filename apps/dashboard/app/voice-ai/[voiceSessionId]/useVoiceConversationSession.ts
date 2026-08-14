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
import type { Language } from "@avatrain/shared/tutor";
import { mintConversationTicket, mintSimliSession } from "../../../lib/api-client";
import { tryConnectLiveKitAvatar, type LiveKitAvatarConnection } from "../../../lib/livekit-avatar-connect";
import type { VoiceExpert } from "../../../lib/fixtures/voice-experts";

export interface VoiceConversationMessage {
  id: string;
  role: "AVATAR" | "USER";
  text: string;
}

interface UseVoiceConversationSessionOptions {
  voiceSessionId: string;
  expert: VoiceExpert;
  containerRef: RefObject<HTMLDivElement>;
  /** True when the mic should be gated off, from either the Mute or Pause control. */
  micDisabled: boolean;
  /** Included in the effect's dependency array — changing it (via the control bar's Language popover) reconnects with the new language rather than silently having no effect on an already-open session. */
  language: Language;
}

interface UseVoiceConversationSessionResult {
  status: ConversationSessionStatus;
  messages: VoiceConversationMessage[];
  pendingTurn: boolean;
  amplitude: number;
  /** True once the Mode B (LiveKit/photoreal) avatar path is live for this session — drives the Photoreal badge. */
  usingLiveKit: boolean;
}

const DEFAULT_WS_BASE = "ws://localhost:4000";

/**
 * Voice AI's counterpart to sessions/[trainingSessionId]/useConversationSession.ts:
 * same WS transport (packages/realtime-core) and avatar rendering
 * (packages/avatar-core), but the persona comes directly from the picked
 * VoiceExpert (voice-experts.ts) rather than the onboarding handoff/localStorage
 * — Voice AI sessions aren't tied to a trainer-built avatar.
 */
export function useVoiceConversationSession({
  voiceSessionId,
  expert,
  containerRef,
  micDisabled,
  language,
}: UseVoiceConversationSessionOptions): UseVoiceConversationSessionResult {
  const [status, setStatus] = useState<ConversationSessionStatus>("connecting");
  const [messages, setMessages] = useState<VoiceConversationMessage[]>([]);
  const [amplitude, setAmplitude] = useState(0);
  const [usingLiveKit, setUsingLiveKit] = useState(false);
  const micTrackRef = useRef<MediaStreamTrack | null>(null);
  const micDisabledRef = useRef(micDisabled);
  const liveKitConnectionRef = useRef<LiveKitAvatarConnection | null>(null);

  useEffect(() => {
    micDisabledRef.current = micDisabled;
    if (micTrackRef.current) micTrackRef.current.enabled = !micDisabled;
    void liveKitConnectionRef.current?.room.localParticipant.setMicrophoneEnabled(!micDisabled);
  }, [micDisabled]);

  useEffect(() => {
    let cancelled = false;
    let handle: { disconnect(): void } | null = null;
    let avatarProvider: AvatarProvider | null = null;
    let liveKitConnection: LiveKitAvatarConnection | null = null;

    // A language change reconnects (this effect re-runs) rather than
    // patching the live session — session.start's language is fixed for the
    // WS connection's lifetime (see conversation-service.ts), and the
    // in-flight transcript belongs to the connection that's ending.
    setStatus("connecting");
    setMessages([]);
    setAmplitude(0);
    setUsingLiveKit(false);

    async function start(): Promise<void> {
      const container = containerRef.current;
      if (!container) return;

      // Mode B (LiveKit/photoreal) attempt first — see
      // useConversationSession.ts's identical block for the full rationale.
      const liveKit = await tryConnectLiveKitAvatar(voiceSessionId, container);
      if (cancelled) {
        liveKit?.disconnect();
        return;
      }
      if (liveKit) {
        liveKitConnection = liveKit;
        liveKitConnectionRef.current = liveKit;
        await liveKit.room.localParticipant.setMicrophoneEnabled(!micDisabledRef.current);
        setUsingLiveKit(true);
        setStatus("listening");
        return;
      }

      const replicaId = resolveReplicaId({ style: expert.style, gender: expert.gender, outfit: expert.outfit });

      avatarProvider = createAvatarProviderFromEnv({
        env: { NEXT_PUBLIC_AVATAR_PROVIDER: process.env.NEXT_PUBLIC_AVATAR_PROVIDER },
        getSimliSessionCredentials: mintSimliSession,
        skinToneHex: SKIN_TONE_HEX[expert.skinTone] ?? null,
        hairColorHex: HAIR_COLOR_HEX[expert.hairColor] ?? null,
        onAmplitudeChange: (value) => {
          if (!cancelled) setAmplitude(value);
        },
      });

      try {
        await avatarProvider.start({ replicaId, container });

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
        micTrack.enabled = !micDisabledRef.current;
        micTrackRef.current = micTrack;

        const wsBase = process.env.NEXT_PUBLIC_API_WS_URL ?? DEFAULT_WS_BASE;
        const wsUrl = `${wsBase}/v1/conversations/${voiceSessionId}/ws?ticket=${encodeURIComponent(ticketResult.ticket)}`;

        handle = await connectConversationSession({
          wsUrl,
          micTrack,
          avatar: avatarProvider,
          sessionConfig: {
            avatarName: expert.name,
            expertise: expert.expertise,
            voiceTone: expert.voiceTone,
            style: expert.style,
            gender: expert.gender,
            outfit: expert.outfit,
            topic: expert.role,
            language,
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
          onError: (message) => {
            console.error("[useVoiceConversationSession] turn error:", message);
          },
        });
      } catch (err) {
        console.error("[useVoiceConversationSession] failed to connect:", err);
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
  }, [voiceSessionId, expert, containerRef, language]);

  return { status, messages, pendingTurn: status === "thinking", amplitude, usingLiveKit };
}
