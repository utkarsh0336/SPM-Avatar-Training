import {
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  LocalVideoTrack,
  Room,
  RoomEvent,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
  VideoSource,
  VideoStream,
  type LocalParticipant,
  type RemoteTrack,
} from "@livekit/rtc-node";
import { connectSimliBridge, type SimliBridge, type SimliConnectionInfo } from "./simli-bridge.js";

/**
 * The two-room relay confirmed necessary by B0's research: Simli always
 * creates and hosts its own LiveKit room (its "LiveKit Backed WebRTC"
 * connection-info message hands back credentials to join THAT room, not a
 * caller-supplied one) — so getting the photoreal avatar in front of the
 * learner/trainer means joining Simli's room as a second connection and
 * republishing what it publishes into OUR OWN room, not a single-room join.
 *
 * Split in two for testability: createAvatarRelay's own orchestration
 * (bridge wiring, the audio-only-to-Simli invariant, skip/stop lifecycle)
 * is real, injectable, and unit-tested below. defaultJoinSimliRoomAndRepublish
 * is real code against @livekit/rtc-node's actual installed API, but is
 * genuinely unverified against a live Simli+LiveKit deployment — the "most
 * likely to need real-world iteration" piece the plan already flags, and
 * exactly what the spec's Manual Verification step exists to catch, not
 * something a unit test can substitute for.
 */

// WebRTC's near-universal audio sample rate — a safe, well-grounded default
// even without a live Simli connection to confirm it against; flagged
// anyway since it's the one unverified constant in an otherwise
// API-grounded implementation.
const RELAY_AUDIO_SAMPLE_RATE = 48000;
const RELAY_AUDIO_CHANNELS = 1;

export interface AvatarRelayOptions {
  simliApiKey: string;
  simliFaceId: string;
  simliWsBaseUrl?: string;
  /** Our own room's local participant — where Simli's republished tracks get published. */
  ourLocalParticipant: LocalParticipant;
  onError?: (message: string) => void;
  /** Injectable for tests; defaults to the real connectSimliBridge. */
  connectSimliBridge?: typeof connectSimliBridge;
  /** Injectable for tests; defaults to defaultJoinSimliRoomAndRepublish. */
  joinSimliRoomAndRepublish?: (
    info: SimliConnectionInfo,
    ourLocalParticipant: LocalParticipant,
  ) => Promise<() => Promise<void>>;
}

export interface AvatarRelay {
  /**
   * Forwards TTS PCM audio to Simli as the lipsync driver — this is the
   * ONLY path audio takes. It must never also be independently published as
   * a second local audio track in our own room; the learner hears the
   * avatar exclusively via Simli's own republished track once the relay
   * connects (or hears nothing from the avatar, degraded, if it hasn't
   * connected yet — never a double/overlapping audio source).
   */
  sendSentenceAudio(audio: Uint8Array): void;
  /** Barge-in — clears Simli's own playback queue. */
  skip(): void;
  stop(): Promise<void>;
}

export async function createAvatarRelay(options: AvatarRelayOptions): Promise<AvatarRelay> {
  const connect = options.connectSimliBridge ?? connectSimliBridge;
  const join = options.joinSimliRoomAndRepublish ?? defaultJoinSimliRoomAndRepublish;

  let republishCleanup: (() => Promise<void>) | null = null;
  let stopped = false;

  const bridge: SimliBridge = await connect(
    { apiKey: options.simliApiKey, faceId: options.simliFaceId, simliWsBaseUrl: options.simliWsBaseUrl },
    {
      onConnectionInfo: (info) => {
        if (stopped) return;
        void join(info, options.ourLocalParticipant)
          .then((cleanup) => {
            if (stopped) {
              void cleanup();
              return;
            }
            republishCleanup = cleanup;
          })
          .catch((err) => options.onError?.(err instanceof Error ? err.message : String(err)));
      },
      onError: (message) => options.onError?.(message),
    },
  );

  return {
    sendSentenceAudio(audio: Uint8Array): void {
      if (stopped) return;
      bridge.sendAudio(audio);
    },
    skip(): void {
      if (stopped) return;
      bridge.skip();
    },
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      bridge.done();
      bridge.close();
      if (republishCleanup) await republishCleanup();
    },
  };
}

async function defaultJoinSimliRoomAndRepublish(
  info: SimliConnectionInfo,
  ourLocalParticipant: LocalParticipant,
): Promise<() => Promise<void>> {
  const simliRoom = new Room();
  await simliRoom.connect(info.livekitUrl, info.livekitToken);

  const cleanupFns: (() => Promise<void>)[] = [];

  async function relayAudio(track: RemoteTrack): Promise<void> {
    const source = new AudioSource(RELAY_AUDIO_SAMPLE_RATE, RELAY_AUDIO_CHANNELS);
    const localTrack = LocalAudioTrack.createAudioTrack("avatar-audio", source);
    await ourLocalParticipant.publishTrack(localTrack, new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }));

    const reader = new AudioStream(track, RELAY_AUDIO_SAMPLE_RATE, RELAY_AUDIO_CHANNELS).getReader();
    cleanupFns.push(async () => {
      await reader.cancel();
      await source.close();
    });

    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      await source.captureFrame(value);
    }
  }

  async function relayVideo(track: RemoteTrack): Promise<void> {
    const reader = new VideoStream(track).getReader();
    let source: VideoSource | null = null;
    cleanupFns.push(async () => {
      await reader.cancel();
      if (source) await source.close();
    });

    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      if (!source) {
        // Dimensions aren't known until the first frame arrives — VideoSource
        // (unlike AudioSource) requires them at construction.
        source = new VideoSource(value.frame.width, value.frame.height);
        const localTrack = LocalVideoTrack.createVideoTrack("avatar-video", source);
        await ourLocalParticipant.publishTrack(localTrack, new TrackPublishOptions({ source: TrackSource.SOURCE_CAMERA }));
      }
      source.captureFrame(value.frame, value.timestampUs, value.rotation);
    }
  }

  simliRoom.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
    if (track.kind === TrackKind.KIND_AUDIO) void relayAudio(track);
    else if (track.kind === TrackKind.KIND_VIDEO) void relayVideo(track);
  });

  return async () => {
    for (const cleanup of cleanupFns) await cleanup();
    await simliRoom.disconnect();
  };
}
