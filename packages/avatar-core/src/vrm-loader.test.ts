import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { VRM } from "@pixiv/three-vrm";
import { loadVrmScene } from "./vrm-loader.js";

function createFakeVrm(overrides: Partial<VRM> = {}): VRM {
  return {
    scene: new THREE.Group(),
    meta: { metaVersion: "1" },
    update: vi.fn(),
    ...overrides,
  } as unknown as VRM;
}

function createFakeContainer() {
  return { clientWidth: 400, clientHeight: 300, appendChild: vi.fn() } as unknown as HTMLElement;
}

function createFakeCanvas() {
  return { style: {}, remove: vi.fn() } as unknown as HTMLCanvasElement;
}

function createFakeRenderer() {
  return {
    setSize: vi.fn(),
    setPixelRatio: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
    domElement: {},
  };
}

describe("loadVrmScene", () => {
  it("mounts a canvas into the container and returns a handle exposing the loaded vrm", async () => {
    const vrm = createFakeVrm();
    const container = createFakeContainer();
    const canvas = createFakeCanvas();
    const renderer = createFakeRenderer();

    const handle = await loadVrmScene({
      modelUrl: "/avatars/vrm/test.vrm",
      container,
      loadGltf: async () => ({ userData: { vrm } }) as unknown as GLTF,
      createCanvas: () => canvas,
      createRenderer: () => renderer,
    });

    expect(container.appendChild).toHaveBeenCalledWith(canvas);
    expect(renderer.setSize).toHaveBeenCalledWith(400, 300);
    expect(handle.vrm).toBe(vrm);
  });

  it("throws a clear error when the loaded GLTF has no VRM extension", async () => {
    await expect(
      loadVrmScene({
        modelUrl: "/avatars/vrm/not-a-vrm.vrm",
        container: createFakeContainer(),
        loadGltf: async () => ({ userData: {} }) as unknown as GLTF,
        createCanvas: createFakeCanvas,
        createRenderer: createFakeRenderer,
      }),
    ).rejects.toThrow(/did not resolve to a valid VRM/);
  });

  it("renderFrame() advances the VRM's own update loop and renders", async () => {
    const vrm = createFakeVrm();
    const renderer = createFakeRenderer();

    const handle = await loadVrmScene({
      modelUrl: "/avatars/vrm/test.vrm",
      container: createFakeContainer(),
      loadGltf: async () => ({ userData: { vrm } }) as unknown as GLTF,
      createCanvas: createFakeCanvas,
      createRenderer: () => renderer,
    });

    handle.renderFrame();

    expect(vrm.update).toHaveBeenCalledWith(expect.any(Number));
    expect(renderer.render).toHaveBeenCalled();
  });

  it("resize() updates the camera aspect and renderer size", async () => {
    const renderer = createFakeRenderer();
    const handle = await loadVrmScene({
      modelUrl: "/avatars/vrm/test.vrm",
      container: createFakeContainer(),
      loadGltf: async () => ({ userData: { vrm: createFakeVrm() } }) as unknown as GLTF,
      createCanvas: createFakeCanvas,
      createRenderer: () => renderer,
    });

    handle.resize(800, 600);
    expect(renderer.setSize).toHaveBeenLastCalledWith(800, 600);
  });

  it("dispose() disposes the renderer and removes the canvas", async () => {
    const canvas = createFakeCanvas();
    const renderer = createFakeRenderer();
    const handle = await loadVrmScene({
      modelUrl: "/avatars/vrm/test.vrm",
      container: createFakeContainer(),
      loadGltf: async () => ({ userData: { vrm: createFakeVrm() } }) as unknown as GLTF,
      createCanvas: () => canvas,
      createRenderer: () => renderer,
    });

    handle.dispose();
    expect(renderer.dispose).toHaveBeenCalled();
    expect(canvas.remove).toHaveBeenCalled();
  });
});
