import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, type VRM } from "@pixiv/three-vrm";

export interface VrmSceneHandle {
  readonly vrm: VRM;
  /** Renders one frame and advances the VRM's own update loop (expressions, spring bones, look-at) by real elapsed time. */
  renderFrame(): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

type MinimalRenderer = Pick<THREE.WebGLRenderer, "setSize" | "setPixelRatio" | "render" | "dispose">;

export interface LoadVrmSceneOptions {
  modelUrl: string;
  container: HTMLElement;
  /** Injectable for tests; defaults to a real GLTFLoader with the VRM plugin registered (touches fetch — never called in a plain-Node test). */
  loadGltf?: (url: string) => Promise<GLTF>;
  /** Injectable for tests; defaults to a real THREE.WebGLRenderer bound to a fresh <canvas> (touches WebGL — never called in a plain-Node test). */
  createRenderer?: (canvas: HTMLCanvasElement) => MinimalRenderer;
  createCanvas?: () => HTMLCanvasElement;
}

const DEFAULT_WIDTH = 512;
const DEFAULT_HEIGHT = 512;

async function defaultLoadGltf(url: string): Promise<GLTF> {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  return loader.loadAsync(url);
}

/**
 * Loads a VRM model into a fresh Three.js scene mounted inside `container`.
 * Shared by vrm-avatar-provider.ts (the live, lip-synced session renderer)
 * and vrm-avatar-preview-renderer.ts (the wizard's static/live preview) so
 * the scene/camera/lighting/renderer boilerplate exists exactly once. Every
 * WebGL/fetch touchpoint is constructor-injectable, matching this package's
 * existing no-jsdom testing convention (see simli-avatar-provider.ts's
 * createSimliClient injection).
 */
export async function loadVrmScene(options: LoadVrmSceneOptions): Promise<VrmSceneHandle> {
  const loadGltf = options.loadGltf ?? defaultLoadGltf;
  const gltf = await loadGltf(options.modelUrl);
  const vrm = (gltf.userData as { vrm?: VRM }).vrm;
  if (!vrm) {
    throw new Error(`vrm-loader: "${options.modelUrl}" did not resolve to a valid VRM (no userData.vrm)`);
  }

  // Legacy VRM 0.x models face +Z; flip to face -Z (Three.js's default
  // camera-facing direction, and what VRM 1.0 models already use) — doing
  // it here once, rather than per consumer, keeps both the live provider
  // and the preview renderer camera-consistent without either needing to
  // know about VRM's facing convention. No-op for VRM 1.0 assets. (Not
  // using three-vrm's own VRMUtils.rotateVRM0 here — its runtime bundle
  // exports it, but this package's "@pixiv/three-vrm" type declarations
  // don't surface it under this project's NodeNext module resolution; the
  // rotation itself is a one-line fix, not worth fighting the types over.)
  if (vrm.meta.metaVersion === "0") vrm.scene.rotateY(Math.PI);

  const width = options.container.clientWidth || DEFAULT_WIDTH;
  const height = options.container.clientHeight || DEFAULT_HEIGHT;
  const canvas = options.createCanvas?.() ?? document.createElement("canvas");
  // Same convention mock-avatar-provider.ts/simli-avatar-provider.ts use
  // for their <video> elements. Note renderer.setSize() below (default
  // updateStyle=true) immediately overwrites style.width/height with a
  // fixed px value matching container size at this instant — these two
  // lines only matter until that call. Neither the CSS box nor the
  // internal drawing-buffer resolution nor the camera aspect track later
  // container-size changes (side panel toggle, fullscreen, window resize)
  // on their own; the consumer must call the returned handle's resize()
  // when the container's size actually changes (see vrm-avatar-provider.ts's
  // ResizeObserver wiring).
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.objectFit = "cover";
  const renderer: MinimalRenderer =
    options.createRenderer?.(canvas) ?? new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio?.(typeof window !== "undefined" ? window.devicePixelRatio : 1);

  const scene = new THREE.Scene();
  scene.add(vrm.scene);
  scene.add(new THREE.DirectionalLight(0xffffff, 1.2).translateOnAxis(new THREE.Vector3(1, 1.5, 1), 1));
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));

  // Bust-frame the camera from the loaded model's own bounding box rather
  // than a fixed head-height guess — replica-resolver.ts's gender/style/
  // outfit combos don't all share one height, and a fixed camera position
  // cropped the head on taller models. Falls back to a plausible bust
  // framing when the model reports no geometry (e.g. this file's own
  // tests, which pass a bare THREE.Group() with no meshes).
  const FOV_DEGREES = 32;
  const HEADROOM_RATIO = 1.25; // vertical padding beyond the raw head-to-chest span
  const BUST_SPAN_RATIO = 0.42; // fraction of standing height framed, chest-up
  const bounds = new THREE.Box3().setFromObject(vrm.scene);
  let frameCenterY = 1.35;
  let frameHeight = 0.7;
  if (!bounds.isEmpty()) {
    const modelHeight = bounds.max.y - bounds.min.y;
    const headTop = bounds.max.y;
    const bustBottom = headTop - modelHeight * BUST_SPAN_RATIO;
    frameCenterY = (headTop + bustBottom) / 2;
    frameHeight = (headTop - bustBottom) * HEADROOM_RATIO;
  }
  const distance = frameHeight / 2 / Math.tan(THREE.MathUtils.degToRad(FOV_DEGREES) / 2);

  const camera = new THREE.PerspectiveCamera(FOV_DEGREES, width / height, 0.1, 20);
  camera.position.set(0, frameCenterY, distance);
  camera.lookAt(0, frameCenterY, 0);

  options.container.appendChild(canvas);

  const timer = new THREE.Timer();

  return {
    vrm,
    renderFrame(): void {
      timer.update();
      const delta = timer.getDelta();
      vrm.update(delta);
      renderer.render(scene, camera);
    },
    resize(width: number, height: number): void {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    },
    dispose(): void {
      renderer.dispose();
      canvas.remove();
    },
  };
}
