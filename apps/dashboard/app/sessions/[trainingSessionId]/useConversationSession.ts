"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { createAvatarProviderFromEnv, resolveReplicaId, type AvatarProvider } from "@avatrain/avatar-core";
import { connectConversationSession, type ConversationSessionStatus } from "@avatrain/realtime-core";
import type { OnboardingHandoff } from "@avatrain/shared/tutor";
import { mintConversationTicket, mintSimliSession } from "../../../lib/api-client";
import { readOnboardingAvatarHandoff } from "../../../lib/onboarding-handoff";

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
}

interface UseConversationSessionResult {
  status: ConversationSessionStatus;
  messages: ConversationMessage[];
  pendingTurn: boolean;
  captionText: string;
  amplitude: number;
}

// Used whenever the trainer opens a session without having completed (or
// after losing) the Avatar Builder handoff — never hard-fails a session.
const DEFAULT_PERSONA: OnboardingHandoff = {
  style: "REALISTIC",
  gender: "FEMALE",
  outfit: "BUSINESS_FORMAL",
  name: "My Avatar",
  expertise: "HR_LEAVE_POLICY",
  voice: "NEUTRAL",
};

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
}: UseConversationSessionOptions): UseConversationSessionResult {
  const [status, setStatus] = useState<ConversationSessionStatus>("connecting");
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [captionText, setCaptionText] = useState("");
  const [amplitude, setAmplitude] = useState(0);
  const micTrackRef = useRef<MediaStreamTrack | null>(null);
  const mutedRef = useRef(muted);

  useEffect(() => {
    mutedRef.current = muted;
    if (micTrackRef.current) micTrackRef.current.enabled = !muted;
  }, [muted]);

  useEffect(() => {
    let cancelled = false;
    let handle: { disconnect(): void } | null = null;
    let avatarProvider: AvatarProvider | null = null;

    async function start(): Promise<void> {
      const container = containerRef.current;
      if (!container) return;

      const persona = readOnboardingAvatarHandoff() ?? DEFAULT_PERSONA;
      const replicaId = resolveReplicaId({ style: persona.style, gender: persona.gender, outfit: persona.outfit });

      avatarProvider = createAvatarProviderFromEnv({
        // Literal process.env.NEXT_PUBLIC_* access, required so Next.js can
        // statically inline it into the client bundle — see
        // avatar-provider-factory.ts's env option doc comment.
        env: { NEXT_PUBLIC_AVATAR_PROVIDER: process.env.NEXT_PUBLIC_AVATAR_PROVIDER },
        getSimliSessionCredentials: mintSimliSession,
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
          navigator.mediaDevices.getUserMedia({ audio: true }),
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
    };
  }, [trainingSessionId, topic, containerRef]);

  return { status, messages, pendingTurn: status === "thinking", captionText, amplitude };
}
