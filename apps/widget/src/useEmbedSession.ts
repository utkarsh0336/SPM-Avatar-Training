import { useEffect, useRef, useState, type RefObject } from "react";
import {
  createAvatarProviderFromEnv,
  resolveReplicaId,
  SKIN_TONE_HEX,
  HAIR_COLOR_HEX,
  type AvatarProvider,
} from "@avatrain/avatar-core";
import { connectConversationSession, type ConversationSessionStatus } from "@avatrain/realtime-core";
import { getEmbedConfig, mintEmbedTicket } from "./api-client.js";

export interface EmbedConversationMessage {
  id: string;
  role: "AVATAR" | "USER";
  text: string;
}

interface UseEmbedSessionOptions {
  /** The publishable key read from this page's own ?key= query param — see App.tsx. */
  embedKey: string;
  containerRef: RefObject<HTMLDivElement>;
  muted: boolean;
}

interface UseEmbedSessionResult {
  status: ConversationSessionStatus | "idle";
  messages: EmbedConversationMessage[];
  captionText: string;
  amplitude: number;
  errorMessage: string | null;
  /**
   * Sends the learner's satisfaction rating (if the session ever connected) and disconnects — see
   * .claude/specs/user-satisfaction.md. Call rateSession() first (optional — pass nothing to skip
   * straight to ending), it just delegates to the connected handle's own rateSession/disconnect;
   * ending before a connection exists is a silent no-op, same posture as the handle's send().
   */
  endSession(rating?: number, comment?: string): void;
}

const DEFAULT_WS_BASE = "ws://localhost:4000";

/**
 * apps/widget's counterpart to apps/dashboard's useConversationSession.ts:
 * same avatar rendering (packages/avatar-core) and WS transport
 * (packages/realtime-core, confirmed dashboard-agnostic already), but the
 * persona comes from GET /v1/embed/config (server-resolved from the
 * Application's pinned avatarId, never client-suppliable) instead of the
 * caller's own Avatar record, and the WS ticket comes from
 * POST /v1/embed/ticket (publishable-key-authenticated, anonymous — no
 * dashboard cookie exists here) instead of the cookie-authenticated
 * /v1/conversations/ticket.
 */
export function useEmbedSession({ embedKey, containerRef, muted }: UseEmbedSessionOptions): UseEmbedSessionResult {
  const [status, setStatus] = useState<ConversationSessionStatus | "idle">("idle");
  const [messages, setMessages] = useState<EmbedConversationMessage[]>([]);
  const [captionText, setCaptionText] = useState("");
  const [amplitude, setAmplitude] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const micTrackRef = useRef<MediaStreamTrack | null>(null);
  const mutedRef = useRef(muted);
  // Mirrors the effect-local `handle` below so endSession() (called from outside the effect, in
  // response to a user click) can reach it — see endSession's own doc comment.
  const handleRef = useRef<Awaited<ReturnType<typeof connectConversationSession>> | null>(null);

  useEffect(() => {
    mutedRef.current = muted;
    if (micTrackRef.current) micTrackRef.current.enabled = !muted;
  }, [muted]);

  useEffect(() => {
    let cancelled = false;
    let handle: Awaited<ReturnType<typeof connectConversationSession>> | null = null;
    let avatarProvider: AvatarProvider | null = null;

    async function start(): Promise<void> {
      const container = containerRef.current;
      if (!container || !embedKey) return;
      setStatus("connecting");

      const config = await getEmbedConfig(embedKey).catch(() => null);
      if (cancelled) return;
      if (!config) {
        setErrorMessage("This avatar isn't available right now.");
        setStatus("error");
        return;
      }

      avatarProvider = createAvatarProviderFromEnv({
        // Same literal-access requirement Next's NEXT_PUBLIC_* has, applied
        // to Vite's own build-time env inlining convention.
        env: { NEXT_PUBLIC_AVATAR_PROVIDER: import.meta.env.VITE_AVATAR_PROVIDER },
        skinToneHex: config.skinTone ? (SKIN_TONE_HEX[config.skinTone] ?? null) : null,
        hairColorHex: config.hairColor ? (HAIR_COLOR_HEX[config.hairColor] ?? null) : null,
        onSubtitleChange: (text) => {
          if (!cancelled) setCaptionText(text);
        },
        onAmplitudeChange: (value) => {
          if (!cancelled) setAmplitude(value);
        },
      });

      try {
        const replicaId = resolveReplicaId({ style: config.style, gender: config.gender, outfit: config.outfit });
        await avatarProvider.start({ replicaId, container });

        const [micStream, ticketResult] = await Promise.all([
          // Native browser DSP, requested explicitly rather than left to
          // user-agent defaults — see .claude/specs/voice-quality-latency-enforcement.md.
          navigator.mediaDevices.getUserMedia({
            audio: { noiseSuppression: true, echoCancellation: true, autoGainControl: true },
          }),
          mintEmbedTicket(embedKey),
        ]);
        const micTrack = micStream.getAudioTracks()[0];
        if (!micTrack) throw new Error("no_microphone_track");
        if (cancelled) {
          micTrack.stop();
          return;
        }
        micTrack.enabled = !mutedRef.current;
        micTrackRef.current = micTrack;

        // trainingSessionId is a free-form, non-empty string (see
        // ws-messages.ts's trainingSessionIdParamSchema) — there's no real
        // TrainingSession row backing it anywhere in this codebase (sessions
        // are ephemeral/client-side, see apps/dashboard's own
        // SessionsContext.tsx), it's a per-connection identifier only.
        // Random per mount so concurrent anonymous embed sessions don't
        // share one label in server-side logs/metrics.
        const embedSessionId = `embed-${crypto.randomUUID()}`;
        const wsBase = import.meta.env.VITE_API_WS_URL ?? DEFAULT_WS_BASE;
        const wsUrl = `${wsBase}/v1/conversations/${embedSessionId}/ws?ticket=${encodeURIComponent(ticketResult.ticket)}`;

        handle = await connectConversationSession({
          wsUrl,
          micTrack,
          avatar: avatarProvider,
          sessionConfig: {
            avatarName: config.avatarName,
            expertise: config.expertise,
            voiceTone: config.voiceTone,
            style: config.style,
            gender: config.gender,
            outfit: config.outfit,
            topic: config.avatarName,
            language: "English",
            avatarId: config.avatarId,
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
            console.error("[useEmbedSession] turn error:", message);
          },
        });
        if (!cancelled) handleRef.current = handle;
      } catch (err) {
        console.error("[useEmbedSession] failed to connect:", err);
        if (!cancelled) {
          setErrorMessage("Couldn't start the session. Please try again.");
          setStatus("error");
        }
      }
    }

    start();

    return () => {
      cancelled = true;
      handle?.disconnect();
      handleRef.current = null;
      micTrackRef.current?.stop();
      micTrackRef.current = null;
      avatarProvider?.stop();
    };
  }, [embedKey, containerRef]);

  function endSession(rating?: number, comment?: string): void {
    const handle = handleRef.current;
    if (!handle) return;
    if (rating !== undefined) handle.rateSession(rating, comment);
    handle.disconnect();
    handleRef.current = null;
  }

  return { status, messages, captionText, amplitude, errorMessage, endSession };
}
