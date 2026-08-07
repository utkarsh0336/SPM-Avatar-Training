import { describe, expect, it, vi } from "vitest";
import { createMockAvatarProvider } from "./mock-avatar-provider.js";

function createFakeVideoElement() {
  const listeners: Record<string, (() => void)[]> = {};
  return {
    loop: false,
    muted: false,
    autoplay: false,
    playsInline: false,
    style: {} as CSSStyleDeclaration,
    src: "",
    addEventListener: vi.fn((event: string, cb: () => void) => {
      listeners[event] = [...(listeners[event] ?? []), cb];
    }),
    triggerError: () => listeners.error?.forEach((cb) => cb()),
    load: vi.fn(),
    play: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn(),
  } as unknown as HTMLVideoElement & { triggerError: () => void; load: () => void };
}

function createFakeAudioElement() {
  return {
    autoplay: false,
    srcObject: null as unknown,
    pause: vi.fn(),
    remove: vi.fn(),
  } as unknown as HTMLAudioElement;
}

function createFakeContainer() {
  return { appendChild: vi.fn() } as unknown as HTMLElement;
}

function createFakeAudioContext() {
  const analyser = {
    fftSize: 0,
    frequencyBinCount: 4,
    getByteTimeDomainData: vi.fn((arr: Uint8Array) => arr.fill(128)),
    connect: vi.fn(),
  };
  const sourceNode = { connect: vi.fn(), disconnect: vi.fn() };
  return {
    createAnalyser: vi.fn(() => analyser),
    createMediaStreamSource: vi.fn(() => sourceNode),
    close: vi.fn(),
    _analyser: analyser,
    _sourceNode: sourceNode,
  } as unknown as AudioContext & { _analyser: typeof analyser; _sourceNode: typeof sourceNode };
}

function createFakeRaf() {
  let nextHandle = 1;
  const pending = new Map<number, () => void>();
  const raf = vi.fn((cb: () => void) => {
    const handle = nextHandle++;
    pending.set(handle, cb);
    return handle;
  });
  const caf = vi.fn((handle: number) => pending.delete(handle));
  const tick = () => {
    const callbacks = [...pending.values()];
    pending.clear();
    callbacks.forEach((cb) => cb());
  };
  return { raf, caf, tick };
}

const fakeTrack = {} as MediaStreamTrack;

describe("createMockAvatarProvider", () => {
  it("start() sets the idle clip path, mounts both elements, and plays", async () => {
    const video = createFakeVideoElement();
    const audio = createFakeAudioElement();
    const container = createFakeContainer();
    const provider = createMockAvatarProvider({
      createVideoElement: () => video,
      createAudioElement: () => audio,
    });

    await provider.start({ replicaId: "realistic-female-business_formal", container });

    expect(video.src).toBe("/avatars/idle/realistic-female-business_formal.mp4");
    expect(container.appendChild).toHaveBeenCalledWith(video);
    expect(container.appendChild).toHaveBeenCalledWith(audio);
    expect(video.play).toHaveBeenCalled();
    expect(provider.videoTrack).toBeNull();
  });

  it("falls back to the placeholder clip on a video error, without looping forever", () => {
    const video = createFakeVideoElement();
    const provider = createMockAvatarProvider({
      createVideoElement: () => video,
      createAudioElement: createFakeAudioElement,
    });
    void provider.start({ replicaId: "missing-replica", container: createFakeContainer() });

    video.triggerError();
    expect(video.src).toBe("/avatars/idle/_placeholder.mp4");
    expect(video.load).toHaveBeenCalledTimes(1);

    // A second error (e.g. the placeholder itself 404s) must not re-trigger
    // an infinite swap loop.
    video.triggerError();
    expect(video.load).toHaveBeenCalledTimes(1);
  });

  it("speak() attaches the audio track, fires the subtitle callback, and reports amplitude", () => {
    const audio = createFakeAudioElement();
    const audioContext = createFakeAudioContext();
    const raf = createFakeRaf();
    const onSubtitleChange = vi.fn();
    const onAmplitudeChange = vi.fn();
    const createMediaStream = vi.fn((tracks: MediaStreamTrack[]) => ({ tracks }) as unknown as MediaStream);

    const provider = createMockAvatarProvider({
      createVideoElement: createFakeVideoElement,
      createAudioElement: () => audio,
      createAudioContext: () => audioContext,
      createMediaStream,
      requestAnimationFrame: raf.raf,
      cancelAnimationFrame: raf.caf,
      onSubtitleChange,
      onAmplitudeChange,
    });

    provider.speak(fakeTrack, "Hello there.");

    expect(onSubtitleChange).toHaveBeenCalledWith("Hello there.");
    expect(audio.srcObject).toEqual({ tracks: [fakeTrack] });
    expect(audioContext._sourceNode.connect).toHaveBeenCalledWith(audioContext._analyser);

    raf.tick();
    expect(onAmplitudeChange).toHaveBeenCalled();
    // Silence (byte value 128 everywhere) normalizes to 0 amplitude.
    expect(onAmplitudeChange).toHaveBeenLastCalledWith(0);
  });

  it("interrupt() pauses audio, clears the subtitle, and zeroes amplitude", () => {
    const audio = createFakeAudioElement();
    const raf = createFakeRaf();
    const onSubtitleChange = vi.fn();
    const onAmplitudeChange = vi.fn();

    const provider = createMockAvatarProvider({
      createVideoElement: createFakeVideoElement,
      createAudioElement: () => audio,
      createAudioContext: createFakeAudioContext,
      createMediaStream: (tracks) => ({ tracks }) as unknown as MediaStream,
      requestAnimationFrame: raf.raf,
      cancelAnimationFrame: raf.caf,
      onSubtitleChange,
      onAmplitudeChange,
    });

    provider.speak(fakeTrack, "Hello there.");
    provider.interrupt();

    expect(audio.pause).toHaveBeenCalled();
    expect(onSubtitleChange).toHaveBeenCalledWith("");
    expect(onAmplitudeChange).toHaveBeenLastCalledWith(0);
    expect(raf.caf).toHaveBeenCalled();
  });

  it("stop() removes mounted elements and closes the audio context", async () => {
    const video = createFakeVideoElement();
    const audio = createFakeAudioElement();
    const audioContext = createFakeAudioContext();
    const raf = createFakeRaf();
    const provider = createMockAvatarProvider({
      createVideoElement: () => video,
      createAudioElement: () => audio,
      createAudioContext: () => audioContext,
      createMediaStream: (tracks) => ({ tracks }) as unknown as MediaStream,
      requestAnimationFrame: raf.raf,
      cancelAnimationFrame: raf.caf,
    });

    await provider.start({ replicaId: "r1", container: createFakeContainer() });
    provider.speak(fakeTrack, "hi");
    provider.stop();

    expect(video.remove).toHaveBeenCalledTimes(1);
    expect(audio.remove).toHaveBeenCalledTimes(1);
    expect(audioContext.close).toHaveBeenCalledTimes(1);
  });

  it("stop() before start() does not throw", () => {
    const provider = createMockAvatarProvider({
      createVideoElement: createFakeVideoElement,
      createAudioElement: createFakeAudioElement,
    });
    expect(() => provider.stop()).not.toThrow();
  });
});
