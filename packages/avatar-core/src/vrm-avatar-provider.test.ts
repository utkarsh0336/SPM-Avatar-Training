import { describe, expect, it, vi } from "vitest";
import type { VRM } from "@pixiv/three-vrm";
import { createVrmAvatarProvider } from "./vrm-avatar-provider.js";
import type { AvatarProvider } from "./index.js";
import type { VrmSceneHandle } from "./vrm-loader.js";

function createFakeVrm(): VRM {
  return {
    scene: { traverse: () => {} },
    expressionManager: { setValue: vi.fn() },
  } as unknown as VRM;
}

function createFakeSceneHandle(vrm: VRM = createFakeVrm()): VrmSceneHandle & { renderFrame: ReturnType<typeof vi.fn> } {
  return {
    vrm,
    renderFrame: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
  };
}

function createFakeContainer() {
  return { appendChild: vi.fn() } as unknown as HTMLElement;
}

function createFakeAudioElement() {
  return { autoplay: false, srcObject: null as unknown, pause: vi.fn(), remove: vi.fn() } as unknown as HTMLAudioElement;
}

function createFakeAudioContext() {
  const analyser = { fftSize: 0, frequencyBinCount: 4, getByteTimeDomainData: vi.fn((arr: Uint8Array) => arr.fill(128)), connect: vi.fn() };
  const sourceNode = { connect: vi.fn(), disconnect: vi.fn() };
  return {
    createAnalyser: vi.fn(() => analyser),
    createMediaStreamSource: vi.fn(() => sourceNode),
    close: vi.fn(),
  } as unknown as AudioContext;
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
  return { raf, caf };
}

function createFakeMockFallback(): AvatarProvider & { start: ReturnType<typeof vi.fn> } {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    speak: vi.fn(),
    interrupt: vi.fn(),
    stop: vi.fn(),
    videoTrack: null,
  };
}

const fakeTrack = {} as MediaStreamTrack;

describe("createVrmAvatarProvider", () => {
  it("start() loads the primary VRM model for the given replica and starts a render loop", async () => {
    const sceneHandle = createFakeSceneHandle();
    const loadScene = vi.fn().mockResolvedValue(sceneHandle);
    const raf = createFakeRaf();
    const container = createFakeContainer();

    const provider = createVrmAvatarProvider({
      loadScene,
      createAudioElement: createFakeAudioElement,
      requestAnimationFrame: raf.raf,
      cancelAnimationFrame: raf.caf,
    });

    await provider.start({ replicaId: "realistic-female-business_formal", container });

    expect(loadScene).toHaveBeenCalledWith({ modelUrl: "/avatars/vrm/realistic-female-business_formal.vrm", container });
    expect(container.appendChild).toHaveBeenCalled();
    expect(raf.raf).toHaveBeenCalled(); // render loop scheduled
    expect(provider.videoTrack).toBeNull();
  });

  it("falls back to the placeholder model if the primary model fails to load", async () => {
    const sceneHandle = createFakeSceneHandle();
    const loadScene = vi.fn().mockRejectedValueOnce(new Error("404")).mockResolvedValueOnce(sceneHandle);
    const container = createFakeContainer();
    const raf = createFakeRaf();

    const provider = createVrmAvatarProvider({
      loadScene,
      createAudioElement: createFakeAudioElement,
      requestAnimationFrame: raf.raf,
      cancelAnimationFrame: raf.caf,
    });
    await provider.start({ replicaId: "missing-replica", container });

    expect(loadScene).toHaveBeenNthCalledWith(1, { modelUrl: "/avatars/vrm/missing-replica.vrm", container });
    expect(loadScene).toHaveBeenNthCalledWith(2, { modelUrl: "/avatars/vrm/_placeholder.vrm", container });
  });

  it("falls back to the injected fallback provider (Mock) if even the placeholder fails to load", async () => {
    const loadScene = vi.fn().mockRejectedValue(new Error("no WebGL"));
    const fallback = createFakeMockFallback();
    const container = createFakeContainer();

    const provider = createVrmAvatarProvider({ loadScene, fallbackProvider: fallback, createAudioElement: createFakeAudioElement });
    await provider.start({ replicaId: "r1", container });

    expect(fallback.start).toHaveBeenCalledWith({ replicaId: "r1", container });
  });

  it("delegates speak()/interrupt()/stop()/videoTrack to the fallback once it's active", async () => {
    const loadScene = vi.fn().mockRejectedValue(new Error("no WebGL"));
    const fallback = createFakeMockFallback();
    const provider = createVrmAvatarProvider({ loadScene, fallbackProvider: fallback, createAudioElement: createFakeAudioElement });

    await provider.start({ replicaId: "r1", container: createFakeContainer() });
    provider.speak(fakeTrack, "hi");
    provider.interrupt();
    provider.stop();

    expect(fallback.speak).toHaveBeenCalledWith(fakeTrack, "hi");
    expect(fallback.interrupt).toHaveBeenCalled();
    expect(fallback.stop).toHaveBeenCalled();
  });

  it("speak() attaches the audio track and drives both the amplitude callback and the mouth expression", async () => {
    const vrm = createFakeVrm();
    const sceneHandle = createFakeSceneHandle(vrm);
    const loadScene = vi.fn().mockResolvedValue(sceneHandle);
    const audioContext = createFakeAudioContext();
    const raf = createFakeRaf();
    const onAmplitudeChange = vi.fn();
    const createMediaStream = vi.fn((tracks: MediaStreamTrack[]) => ({ tracks }) as unknown as MediaStream);

    const provider = createVrmAvatarProvider({
      loadScene,
      createAudioElement: createFakeAudioElement,
      createAudioContext: () => audioContext,
      createMediaStream,
      requestAnimationFrame: raf.raf,
      cancelAnimationFrame: raf.caf,
      onAmplitudeChange,
    });

    await provider.start({ replicaId: "r1", container: createFakeContainer() });
    provider.speak(fakeTrack, "Hello there.");

    expect(audioContext.createAnalyser).toHaveBeenCalled();
    expect(onAmplitudeChange).not.toHaveBeenCalled(); // only fires once the raf loop ticks
  });

  it("interrupt() resets the mouth expression to 0 and pauses audio", async () => {
    const vrm = createFakeVrm();
    const sceneHandle = createFakeSceneHandle(vrm);
    const loadScene = vi.fn().mockResolvedValue(sceneHandle);
    const audio = createFakeAudioElement();
    const raf = createFakeRaf();
    const provider = createVrmAvatarProvider({
      loadScene,
      createAudioElement: () => audio,
      createAudioContext: createFakeAudioContext,
      createMediaStream: (tracks) => ({ tracks }) as unknown as MediaStream,
      requestAnimationFrame: raf.raf,
      cancelAnimationFrame: raf.caf,
    });

    await provider.start({ replicaId: "r1", container: createFakeContainer() });
    provider.speak(fakeTrack, "hi");
    provider.interrupt();

    expect(audio.pause).toHaveBeenCalled();
    expect((vrm.expressionManager!.setValue as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("aa", 0);
  });

  it("stop() disposes the scene and stops the render loop", async () => {
    const sceneHandle = createFakeSceneHandle();
    const loadScene = vi.fn().mockResolvedValue(sceneHandle);
    const raf = createFakeRaf();
    const audio = createFakeAudioElement();

    const provider = createVrmAvatarProvider({
      loadScene,
      createAudioElement: () => audio,
      requestAnimationFrame: raf.raf,
      cancelAnimationFrame: raf.caf,
    });

    await provider.start({ replicaId: "r1", container: createFakeContainer() });
    provider.stop();

    expect(sceneHandle.dispose).toHaveBeenCalled();
    expect(audio.remove).toHaveBeenCalled();
    expect(raf.caf).toHaveBeenCalled();
  });

  it("stop() before start() does not throw", () => {
    const provider = createVrmAvatarProvider({ createAudioElement: createFakeAudioElement });
    expect(() => provider.stop()).not.toThrow();
  });
});
