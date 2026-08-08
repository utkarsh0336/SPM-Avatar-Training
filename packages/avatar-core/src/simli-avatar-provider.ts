import { SimliClient } from "simli-client";
import type { AvatarProvider, AvatarProviderStartConfig } from "./index.js";

export interface SimliSessionCredentials {
  sessionToken: string;
  /**
   * Required by SimliClient's default P2P WebRTC transport — omitting these
   * makes it throw "Ice Servers Required for P2P Mode" (confirmed against a
   * live session). Mint server-side alongside the session_token (both need
   * the raw Simli API key, which must never reach the browser).
   */
  iceServers: RTCIceServer[];
}

export interface SimliAvatarProviderOptions {
  /**
   * Resolves session credentials minted server-side (e.g.
   * POST /v1/conversations/simli-session) — the raw Simli API key must never
   * reach this adapter or the browser. See
   * .claude/specs/avatar-builder-customization.md.
   */
  getSessionCredentials: () => Promise<SimliSessionCredentials>;
  onSubtitleChange?: (text: string) => void;
  /** Injectable for tests; defaults to document.createElement("video"). */
  createVideoElement?: () => HTMLVideoElement;
  /** Injectable for tests; defaults to document.createElement("audio"). */
  createAudioElement?: () => HTMLAudioElement;
  /** Injectable for tests; defaults to the real SimliClient constructor. */
  createSimliClient?: (
    sessionToken: string,
    videoElement: HTMLVideoElement,
    audioElement: HTMLAudioElement,
    iceServers: RTCIceServer[],
  ) => Pick<
    SimliClient,
    "start" | "stop" | "listenToMediastreamTrack" | "ClearBuffer" | "on" | "off"
  >;
}

type SimliClientLike = ReturnType<NonNullable<SimliAvatarProviderOptions["createSimliClient"]>>;

/**
 * Real, paid photoreal talking-avatar provider — the AvatarProvider-shaped
 * counterpart to MockAvatarProvider, selected via AVATAR_PROVIDER=simli (see
 * avatar-provider-factory.ts). Opt-in only: never constructed unless a
 * caller explicitly wires it up, matching the "write the adapter, gate it,
 * never call it by default" convention already used for Tavus/HeyGen in
 * .claude/specs/ai-avatar.md.
 */
export function createSimliAvatarProvider(options: SimliAvatarProviderOptions): AvatarProvider {
  const videoElement = options.createVideoElement?.() ?? document.createElement("video");
  videoElement.autoplay = true;
  videoElement.playsInline = true;
  videoElement.style.width = "100%";
  videoElement.style.height = "100%";
  videoElement.style.objectFit = "cover";

  const audioElement = options.createAudioElement?.() ?? document.createElement("audio");
  audioElement.autoplay = true;

  const createClient =
    options.createSimliClient ??
    ((sessionToken: string, video: HTMLVideoElement, audio: HTMLAudioElement, iceServers: RTCIceServer[]) =>
      new SimliClient(sessionToken, video, audio, iceServers));

  let client: SimliClientLike | null = null;
  let container: HTMLElement | null = null;
  let mounted = false;
  let remoteVideoTrack: MediaStreamTrack | null = null;
  // Guards against stop() racing an in-flight start() — e.g. React 18
  // StrictMode's dev-only mount→cleanup→mount double-invoke, or a real fast
  // unmount. Without this, start() resuming after its await (credentials
  // mint) would call container.appendChild on the null stop() already set,
  // crashing with "Cannot read properties of null" (reproduced against a
  // live session during manual verification).
  let stopped = false;

  // Duck-typed rather than `instanceof MediaStream` — this package's tests
  // run in plain Node (no MediaStream global), same reasoning as
  // mock-avatar-provider.ts's injectable createMediaStream option.
  function captureRemoteVideoTrack(): void {
    const stream = videoElement.srcObject as { getVideoTracks?: () => MediaStreamTrack[] } | null;
    remoteVideoTrack = stream?.getVideoTracks?.()[0] ?? null;
  }

  return {
    async start(config: AvatarProviderStartConfig): Promise<void> {
      stopped = false;
      container = config.container;
      const { sessionToken, iceServers } = await options.getSessionCredentials();
      if (stopped) return;

      const newClient = createClient(sessionToken, videoElement, audioElement, iceServers);
      newClient.on("error", (detail: string) => {
        console.error("[SimliAvatarProvider] error:", detail);
      });
      newClient.on("startup_error", (message: string) => {
        console.error("[SimliAvatarProvider] startup_error:", message);
      });

      // Robust to SimliClient's internal event/promise ordering — this
      // fires whenever the remote MediaStream actually starts flowing,
      // regardless of exactly when start()'s promise resolves relative to
      // the WebRTC ontrack event that sets videoElement.srcObject.
      videoElement.addEventListener("loadedmetadata", captureRemoteVideoTrack);

      client = newClient;
      container.appendChild(videoElement);
      container.appendChild(audioElement);
      mounted = true;

      await newClient.start();
      if (stopped) return;
      captureRemoteVideoTrack();
    },

    speak(audioTrack: MediaStreamTrack, subtitleText: string): void {
      options.onSubtitleChange?.(subtitleText);
      client?.listenToMediastreamTrack(audioTrack);
    },

    interrupt(): void {
      client?.ClearBuffer();
      options.onSubtitleChange?.("");
    },

    stop(): void {
      stopped = true;
      videoElement.removeEventListener("loadedmetadata", captureRemoteVideoTrack);
      void client?.stop();
      client = null;
      if (mounted && container) {
        videoElement.remove();
        audioElement.remove();
      }
      mounted = false;
      container = null;
      remoteVideoTrack = null;
    },

    get videoTrack(): MediaStreamTrack | null {
      return remoteVideoTrack;
    },
  };
}
