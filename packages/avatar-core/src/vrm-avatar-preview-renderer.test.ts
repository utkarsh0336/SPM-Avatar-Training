import { describe, expect, it, vi } from "vitest";
import type { VRM } from "@pixiv/three-vrm";
import { createVrmAvatarPreviewRenderer } from "./vrm-avatar-preview-renderer.js";
import type { AvatarPreviewConfig, AvatarPreviewRenderer } from "./avatar-preview-renderer.js";
import type { VrmSceneHandle } from "./vrm-loader.js";

function createFakeVrm(): VRM {
  return { scene: { traverse: () => {} } } as unknown as VRM;
}

function createFakeSceneHandle(): VrmSceneHandle {
  return { vrm: createFakeVrm(), renderFrame: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
}

function createFakeContainer() {
  return { appendChild: vi.fn() } as unknown as HTMLElement;
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

function createFakeFallback(): AvatarPreviewRenderer & { render: ReturnType<typeof vi.fn> } {
  return { render: vi.fn().mockResolvedValue(undefined), update: vi.fn(), destroy: vi.fn() };
}

const baseConfig: AvatarPreviewConfig = {
  style: "REALISTIC",
  gender: "FEMALE",
  skinTone: "TONE_2",
  hairStyle: "MEDIUM",
  hairColor: "AUBURN",
  outfit: "BUSINESS_FORMAL",
  previewProvider: "NONE",
  avatarModelUrl: null,
  avatarSnapshotUrl: null,
};

describe("createVrmAvatarPreviewRenderer", () => {
  it("render() resolves a replica from style/gender/outfit and loads that VRM model", async () => {
    const sceneHandle = createFakeSceneHandle();
    const loadScene = vi.fn().mockResolvedValue(sceneHandle);
    const raf = createFakeRaf();
    const container = createFakeContainer();

    const renderer = createVrmAvatarPreviewRenderer({ loadScene, requestAnimationFrame: raf.raf, cancelAnimationFrame: raf.caf });
    await renderer.render(baseConfig, container);

    expect(loadScene).toHaveBeenCalledWith({ modelUrl: "/avatars/vrm/realistic-female-business_formal.vrm", container });
    expect(raf.raf).toHaveBeenCalled();
  });

  it("update() with only skinTone/hairColor changed re-tints without reloading the model", async () => {
    const sceneHandle = createFakeSceneHandle();
    const loadScene = vi.fn().mockResolvedValue(sceneHandle);
    const raf = createFakeRaf();
    const renderer = createVrmAvatarPreviewRenderer({ loadScene, requestAnimationFrame: raf.raf, cancelAnimationFrame: raf.caf });

    await renderer.render(baseConfig, createFakeContainer());
    expect(loadScene).toHaveBeenCalledTimes(1);

    renderer.update({ ...baseConfig, skinTone: "TONE_5", hairColor: "BLONDE" });
    expect(loadScene).toHaveBeenCalledTimes(1); // no reload — same replica
  });

  it("update() with a different gender reloads a different VRM model", async () => {
    const loadScene = vi.fn().mockResolvedValue(createFakeSceneHandle());
    const raf = createFakeRaf();
    const renderer = createVrmAvatarPreviewRenderer({ loadScene, requestAnimationFrame: raf.raf, cancelAnimationFrame: raf.caf });

    await renderer.render(baseConfig, createFakeContainer());
    renderer.update({ ...baseConfig, gender: "MALE", outfit: "BUSINESS_CASUAL" });

    expect(loadScene).toHaveBeenCalledTimes(2);
    expect(loadScene).toHaveBeenLastCalledWith(
      expect.objectContaining({ modelUrl: "/avatars/vrm/realistic-male-business_casual.vrm" }),
    );
  });

  it("falls back to the injected fallback renderer if both the model and placeholder fail to load", async () => {
    const loadScene = vi.fn().mockRejectedValue(new Error("no WebGL"));
    const fallback = createFakeFallback();
    const container = createFakeContainer();

    const renderer = createVrmAvatarPreviewRenderer({ loadScene, fallbackRenderer: fallback });
    await renderer.render(baseConfig, container);

    expect(fallback.render).toHaveBeenCalledWith(baseConfig, container);
  });

  it("destroy() disposes the scene and stops the render loop", async () => {
    const sceneHandle = createFakeSceneHandle();
    const loadScene = vi.fn().mockResolvedValue(sceneHandle);
    const raf = createFakeRaf();
    const renderer = createVrmAvatarPreviewRenderer({ loadScene, requestAnimationFrame: raf.raf, cancelAnimationFrame: raf.caf });

    await renderer.render(baseConfig, createFakeContainer());
    renderer.destroy();

    expect(sceneHandle.dispose).toHaveBeenCalled();
    expect(raf.caf).toHaveBeenCalled();
  });

  it("destroy() before render() does not throw", () => {
    const renderer = createVrmAvatarPreviewRenderer({});
    expect(() => renderer.destroy()).not.toThrow();
  });
});
