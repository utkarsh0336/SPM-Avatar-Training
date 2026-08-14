import { generateSimliSessionToken } from "simli-client";
import { WebSocket } from "ws";

/**
 * Node-side counterpart to apps/api/src/lib/simli.ts's mintSimliSession —
 * deliberately its own small adapter rather than shared code across the
 * apps/api / apps/agent process boundary, same duplication precedent
 * AvatarEmotion/AvatarProviderStartConfig already establish elsewhere in
 * this codebase (safer than refactoring a working paid-provider file for
 * uncertain cross-app benefit).
 *
 * Talks to Simli's documented "LiveKit Backed WebRTC" mode — a plain
 * WebSocket protocol confirmed against the installed simli-client package's
 * own LivekitTransport/WebSocketSignaling/BaseTransport source (lib/
 * transports/LivekitTransport.ts, lib/signaling/WebSocketSignaling.ts,
 * lib/transports/BaseTransport.ts), not guessed from docs:
 *
 *   wss://api.simli.ai/compose/webrtc/livekit?session_token=...
 *
 * Simli always creates and hosts its own LiveKit room — the "connection
 * info" message hands back { livekit_url, livekit_token } to join THAT
 * room, not a caller-supplied one (confirmed live via B0's research, before
 * this file existed). avatar-relay.ts is what actually joins it.
 */

export type SimliBridgeEventType = "ack" | "connectionInfo" | "speaking" | "silent" | "stop" | "error" | "unknown";

export interface SimliConnectionInfo {
  livekitUrl: string;
  livekitToken: string;
}

export interface SimliBridgeEvents {
  onAck?: () => void;
  onConnectionInfo?: (info: SimliConnectionInfo) => void;
  onSpeaking?: () => void;
  onSilent?: () => void;
  /** Simli-initiated stop (e.g. its own STOP/ENDFRAME message) — distinct from our own close(). */
  onStop?: () => void;
  onError?: (message: string) => void;
}

export interface SimliBridge {
  /** Raw PCM lipsync-driver audio for normal (queued) playback. */
  sendAudio(audioBytes: Uint8Array): void;
  /** Same, but tells Simli to play it immediately, skipping whatever's queued — used for barge-in continuity. */
  sendAudioImmediate(audioBytes: Uint8Array): void;
  /** Clears Simli's own playback buffer — the barge-in signal itself. */
  skip(): void;
  /** Finalizes the session (sent at teardown, before close()). */
  done(): void;
  close(): void;
}

export interface SimliBridgeOptions {
  apiKey: string;
  faceId: string;
  /** Defaults to Simli's real endpoint; overridable for tests/self-hosted. */
  simliWsBaseUrl?: string;
  handleSilence?: boolean;
  maxSessionLength?: number;
  maxIdleTime?: number;
  /** Injectable for tests; defaults to the real generateSimliSessionToken. */
  generateToken?: typeof generateSimliSessionToken;
  /** Injectable for tests; defaults to `(url) => new WebSocket(url)`. */
  createWebSocket?: (url: string) => WebSocketLike;
}

/** Minimal structural subset of `ws`'s WebSocket — real `ws.WebSocket` satisfies this. */
export interface WebSocketLike {
  on(event: "open" | "error" | "close", listener: (...args: unknown[]) => void): unknown;
  on(event: "message", listener: (data: unknown) => void): unknown;
  send(data: string | Uint8Array): void;
  close(): void;
}

const DEFAULT_SIMLI_WS_BASE_URL = "wss://api.simli.ai";
const PLAY_IMMEDIATE_PREFIX = new TextEncoder().encode("PLAY_IMMEDIATE");

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * Parses one incoming text control frame, per the exact first-token switch
 * confirmed in simli-client's own BaseTransport.ts handleMessage — but
 * correctly `break`s every case (that file's own ERROR/RATE/CLOSING cases
 * fall through into its SPEAK case, which reads like an unintentional bug,
 * not a documented protocol behavior; not replicated here).
 */
function handleFrame(text: string, events: SimliBridgeEvents): void {
  const firstToken = text.toUpperCase().split(" ")[0] ?? "";
  switch (firstToken) {
    case "START":
      return; // soft ignore, matches vendor behavior
    case "ACK":
      events.onAck?.();
      return;
    case "STOP":
      events.onStop?.();
      return;
    case "CLOSING":
    case "RATE":
    case "ERROR":
    case "ERROR:":
      events.onError?.(text);
      return;
    case "SPEAK":
      events.onSpeaking?.();
      return;
    case "SILENT":
      events.onSilent?.();
      return;
    default:
      if (firstToken.includes("LIVEKIT") || firstToken.includes("SDP")) {
        try {
          const parsed = JSON.parse(text) as { livekit_url?: string; livekit_token?: string };
          if (parsed.livekit_url && parsed.livekit_token) {
            events.onConnectionInfo?.({ livekitUrl: parsed.livekit_url, livekitToken: parsed.livekit_token });
            return;
          }
        } catch {
          // fall through to onError below
        }
        events.onError?.("Invalid connection-info frame from Simli");
      }
      // ENDFRAME/VIDEO_METADATA/DESTINATION/unrecognized — no handler needed
      // for this bridge's own concerns (avatar-relay.ts owns video-track
      // lifecycle via the LiveKit room itself, not this control channel).
      return;
  }
}

export async function connectSimliBridge(
  options: SimliBridgeOptions,
  events: SimliBridgeEvents = {},
): Promise<SimliBridge> {
  const generateToken = options.generateToken ?? generateSimliSessionToken;
  const { session_token: sessionToken } = await generateToken({
    apiKey: options.apiKey,
    config: {
      faceId: options.faceId,
      handleSilence: options.handleSilence ?? true,
      maxSessionLength: options.maxSessionLength ?? 600,
      maxIdleTime: options.maxIdleTime ?? 60,
    },
  });

  const baseUrl = options.simliWsBaseUrl ?? DEFAULT_SIMLI_WS_BASE_URL;
  const wsUrl = `${baseUrl}/compose/webrtc/livekit?session_token=${encodeURIComponent(sessionToken)}`;
  const createWebSocket = options.createWebSocket ?? ((url: string) => new WebSocket(url) as unknown as WebSocketLike);
  const ws = createWebSocket(wsUrl);

  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => resolve());
    ws.on("error", (err: unknown) => reject(err instanceof Error ? err : new Error(String(err))));
  });

  ws.on("message", (data: unknown) => {
    if (typeof data === "string") {
      handleFrame(data, events);
      return;
    }
    if (data instanceof Buffer || data instanceof ArrayBuffer) {
      // Simli's own protocol only ever sends text control frames back — a
      // binary reply isn't part of the documented contract. Route through
      // onError rather than silently dropping, since it signals either a
      // protocol change or a real bug.
      events.onError?.("Received unexpected binary frame from Simli");
    }
  });

  return {
    sendAudio(audioBytes: Uint8Array): void {
      ws.send(audioBytes);
    },
    sendAudioImmediate(audioBytes: Uint8Array): void {
      ws.send(concatBytes(PLAY_IMMEDIATE_PREFIX, audioBytes));
    },
    skip(): void {
      ws.send("SKIP");
    },
    done(): void {
      ws.send("DONE");
    },
    close(): void {
      ws.close();
    },
  };
}
