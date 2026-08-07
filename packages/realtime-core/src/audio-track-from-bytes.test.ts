import { describe, expect, it, vi } from "vitest";
import { createAudioTrackFromBytes } from "./audio-track-from-bytes.js";

function createFakeAudioContext(audioBuffer: unknown, track: unknown | undefined) {
  const source = {
    buffer: null as unknown,
    connect: vi.fn(),
    start: vi.fn(),
    onended: null as (() => void) | null,
  };
  const context = {
    decodeAudioData: vi.fn().mockResolvedValue(audioBuffer),
    createMediaStreamDestination: vi.fn(() => ({
      stream: { getAudioTracks: () => (track ? [track] : []) },
    })),
    createBufferSource: vi.fn(() => source),
  };
  return { context, source };
}

describe("createAudioTrackFromBytes", () => {
  it("decodes the bytes, wires the buffer into a source, and returns a playable track", async () => {
    const track = {} as MediaStreamTrack;
    const audioBuffer = {};
    const { context, source } = createFakeAudioContext(audioBuffer, track);

    const result = await createAudioTrackFromBytes({
      audioBytes: new ArrayBuffer(4),
      createAudioContext: () => context as unknown as AudioContext,
    });

    expect(result.track).toBe(track);
    expect(source.buffer).toBe(audioBuffer);
    expect(source.connect).toHaveBeenCalled();

    result.play();
    expect(source.start).toHaveBeenCalledTimes(1);
  });

  it("resolves onEnded once the underlying source fires onended", async () => {
    const track = {} as MediaStreamTrack;
    const { context, source } = createFakeAudioContext({}, track);

    const result = await createAudioTrackFromBytes({
      audioBytes: new ArrayBuffer(4),
      createAudioContext: () => context as unknown as AudioContext,
    });

    let ended = false;
    void result.onEnded.then(() => {
      ended = true;
    });
    expect(ended).toBe(false);

    source.onended?.();
    await Promise.resolve();
    expect(ended).toBe(true);
  });

  it("throws when the destination produces no audio track", async () => {
    const { context } = createFakeAudioContext({}, undefined);

    await expect(
      createAudioTrackFromBytes({
        audioBytes: new ArrayBuffer(4),
        createAudioContext: () => context as unknown as AudioContext,
      }),
    ).rejects.toThrow("audio_track_from_bytes_no_track");
  });
});
