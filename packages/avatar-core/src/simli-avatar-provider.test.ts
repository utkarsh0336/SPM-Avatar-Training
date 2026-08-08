import { describe, expect, it, vi } from "vitest";
import { createSimliAvatarProvider } from "./simli-avatar-provider.js";

function createFakeVideoElement() {
  const listeners: Record<string, (() => void)[]> = {};
  return {
    autoplay: false,
    playsInline: false,
    style: {} as CSSStyleDeclaration,
    srcObject: null as unknown,
    addEventListener: vi.fn((event: string, cb: () => void) => {
      listeners[event] = [...(listeners[event] ?? []), cb];
    }),
    removeEventListener: vi.fn(),
    triggerLoadedMetadata: () => listeners.loadedmetadata?.forEach((cb) => cb()),
    remove: vi.fn(),
  } as unknown as HTMLVideoElement & { triggerLoadedMetadata: () => void };
}

function createFakeAudioElement() {
  return { autoplay: false, remove: vi.fn() } as unknown as HTMLAudioElement;
}

function createFakeContainer() {
  return { appendChild: vi.fn() } as unknown as HTMLElement;
}

function createFakeSimliClient() {
  const handlers: Record<string, ((arg: string) => void)[]> = {};
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    listenToMediastreamTrack: vi.fn(),
    ClearBuffer: vi.fn(),
    on: vi.fn((event: string, cb: (arg: string) => void) => {
      handlers[event] = [...(handlers[event] ?? []), cb];
    }),
    off: vi.fn(),
    trigger: (event: string, arg: string) => handlers[event]?.forEach((cb) => cb(arg)),
  };
}

const fakeAudioTrack = {} as MediaStreamTrack;
const fakeVideoTrack = {} as MediaStreamTrack;
const FAKE_ICE_SERVERS = [{ urls: "stun:stun.simli.ai:3478" }];
const fakeCredentials = () => Promise.resolve({ sessionToken: "tok", iceServers: FAKE_ICE_SERVERS });

describe("createSimliAvatarProvider", () => {
  it("start() mints session credentials, constructs the client, mounts both elements, and calls start()", async () => {
    const video = createFakeVideoElement();
    const audio = createFakeAudioElement();
    const container = createFakeContainer();
    const client = createFakeSimliClient();
    const getSessionCredentials = vi
      .fn()
      .mockResolvedValue({ sessionToken: "tok_abc", iceServers: FAKE_ICE_SERVERS });
    const createSimliClient = vi.fn().mockReturnValue(client);

    const provider = createSimliAvatarProvider({
      getSessionCredentials,
      createVideoElement: () => video,
      createAudioElement: () => audio,
      createSimliClient,
    });

    await provider.start({ replicaId: "unused", container });

    expect(getSessionCredentials).toHaveBeenCalled();
    expect(createSimliClient).toHaveBeenCalledWith("tok_abc", video, audio, FAKE_ICE_SERVERS);
    expect(container.appendChild).toHaveBeenCalledWith(video);
    expect(container.appendChild).toHaveBeenCalledWith(audio);
    expect(client.start).toHaveBeenCalled();
  });

  it("captures the remote video track once the video element's stream loads", async () => {
    const video = createFakeVideoElement();
    const client = createFakeSimliClient();
    const provider = createSimliAvatarProvider({
      getSessionCredentials: fakeCredentials,
      createVideoElement: () => video,
      createAudioElement: createFakeAudioElement,
      createSimliClient: () => client,
    });

    await provider.start({ replicaId: "unused", container: createFakeContainer() });
    expect(provider.videoTrack).toBeNull();

    (video as unknown as { srcObject: unknown }).srcObject = {
      getVideoTracks: () => [fakeVideoTrack],
    };
    video.triggerLoadedMetadata();

    expect(provider.videoTrack).toBe(fakeVideoTrack);
  });

  it("speak() forwards the audio track to the client and fires the subtitle callback", async () => {
    const client = createFakeSimliClient();
    const onSubtitleChange = vi.fn();
    const provider = createSimliAvatarProvider({
      getSessionCredentials: fakeCredentials,
      createVideoElement: createFakeVideoElement,
      createAudioElement: createFakeAudioElement,
      createSimliClient: () => client,
      onSubtitleChange,
    });
    await provider.start({ replicaId: "unused", container: createFakeContainer() });

    provider.speak(fakeAudioTrack, "Hello there.");

    expect(client.listenToMediastreamTrack).toHaveBeenCalledWith(fakeAudioTrack);
    expect(onSubtitleChange).toHaveBeenCalledWith("Hello there.");
  });

  it("interrupt() clears the Simli audio buffer and the subtitle", async () => {
    const client = createFakeSimliClient();
    const onSubtitleChange = vi.fn();
    const provider = createSimliAvatarProvider({
      getSessionCredentials: fakeCredentials,
      createVideoElement: createFakeVideoElement,
      createAudioElement: createFakeAudioElement,
      createSimliClient: () => client,
      onSubtitleChange,
    });
    await provider.start({ replicaId: "unused", container: createFakeContainer() });

    provider.interrupt();

    expect(client.ClearBuffer).toHaveBeenCalled();
    expect(onSubtitleChange).toHaveBeenCalledWith("");
  });

  it("stop() tears down the client and removes mounted elements", async () => {
    const video = createFakeVideoElement();
    const audio = createFakeAudioElement();
    const client = createFakeSimliClient();
    const provider = createSimliAvatarProvider({
      getSessionCredentials: fakeCredentials,
      createVideoElement: () => video,
      createAudioElement: () => audio,
      createSimliClient: () => client,
    });
    await provider.start({ replicaId: "unused", container: createFakeContainer() });

    provider.stop();

    expect(client.stop).toHaveBeenCalled();
    expect(video.remove).toHaveBeenCalledTimes(1);
    expect(audio.remove).toHaveBeenCalledTimes(1);
    expect(provider.videoTrack).toBeNull();
  });

  it("stop() before start() does not throw", () => {
    const provider = createSimliAvatarProvider({
      getSessionCredentials: fakeCredentials,
      createVideoElement: createFakeVideoElement,
      createAudioElement: createFakeAudioElement,
    });
    expect(() => provider.stop()).not.toThrow();
  });

  // Reproduces a real crash found via manual browser verification: React 18
  // StrictMode's dev-only mount→cleanup→mount double-invoke calls stop()
  // while the first start()'s credentials fetch is still in flight. Without
  // a cancellation guard, start() resumes and calls container.appendChild
  // on the null stop() already set, throwing "Cannot read properties of
  // null (reading 'appendChild')".
  it("stop() racing an in-flight start() does not touch the DOM once the pending credentials fetch resolves", async () => {
    const video = createFakeVideoElement();
    const audio = createFakeAudioElement();
    const container = createFakeContainer();
    const client = createFakeSimliClient();
    let resolveCredentials!: (value: { sessionToken: string; iceServers: typeof FAKE_ICE_SERVERS }) => void;
    const pendingCredentials = new Promise<{ sessionToken: string; iceServers: typeof FAKE_ICE_SERVERS }>(
      (resolve) => {
        resolveCredentials = resolve;
      },
    );

    const provider = createSimliAvatarProvider({
      getSessionCredentials: () => pendingCredentials,
      createVideoElement: () => video,
      createAudioElement: () => audio,
      createSimliClient: () => client,
    });

    const startPromise = provider.start({ replicaId: "unused", container });
    provider.stop(); // races the still-pending credentials fetch
    resolveCredentials({ sessionToken: "tok", iceServers: FAKE_ICE_SERVERS });

    await expect(startPromise).resolves.toBeUndefined();
    expect(container.appendChild).not.toHaveBeenCalled();
    expect(client.start).not.toHaveBeenCalled();
  });
});
