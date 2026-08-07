export interface DecodedAudioTrack {
  track: MediaStreamTrack;
  play(): void;
  onEnded: Promise<void>;
}

export interface CreateAudioTrackFromBytesOptions {
  audioBytes: ArrayBuffer;
  /** Injectable for tests; defaults to a real AudioContext. */
  createAudioContext?: () => AudioContext;
}

/**
 * Decodes one sentence's synthesized TTS audio into a live MediaStreamTrack
 * via the Web Audio API, so it can be handed to an AvatarProvider's
 * speak(track, text) — see packages/avatar-core's AvatarProvider interface
 * and conversation-session.ts.
 */
export async function createAudioTrackFromBytes(
  options: CreateAudioTrackFromBytesOptions,
): Promise<DecodedAudioTrack> {
  const audioContext = options.createAudioContext?.() ?? new AudioContext();
  // decodeAudioData may detach/transfer the buffer — copy defensively so a
  // caller reusing the original ArrayBuffer isn't affected.
  const audioBuffer = await audioContext.decodeAudioData(options.audioBytes.slice(0));

  const destination = audioContext.createMediaStreamDestination();
  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(destination);

  const track = destination.stream.getAudioTracks()[0];
  if (!track) {
    throw new Error("audio_track_from_bytes_no_track");
  }

  let resolveEnded!: () => void;
  const onEnded = new Promise<void>((resolve) => {
    resolveEnded = resolve;
  });
  source.onended = () => resolveEnded();

  return {
    track,
    play: () => source.start(),
    onEnded,
  };
}
