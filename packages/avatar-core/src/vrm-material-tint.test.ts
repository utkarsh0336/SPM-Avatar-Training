import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import { applyMaterialTints } from "./vrm-material-tint.js";

function createFakeMesh(materialName: string) {
  const material = new THREE.MeshStandardMaterial({ name: materialName, color: 0x808080 });
  return { isMesh: true, material } as unknown as THREE.Mesh;
}

function createFakeVrm(meshes: THREE.Mesh[]): VRM {
  return {
    scene: {
      traverse: (callback: (node: THREE.Object3D) => void) => meshes.forEach((mesh) => callback(mesh)),
    },
  } as unknown as VRM;
}

describe("applyMaterialTints", () => {
  it("tints a material whose name matches a skin hint, cloning rather than mutating in place", () => {
    const mesh = createFakeMesh("Body");
    const originalMaterial = mesh.material as THREE.MeshStandardMaterial;
    const vrm = createFakeVrm([mesh]);

    applyMaterialTints(vrm, { skinToneHex: "#ff0000" });

    const tinted = mesh.material as THREE.MeshStandardMaterial;
    expect(tinted).not.toBe(originalMaterial); // cloned, not mutated
    expect(originalMaterial.color.getHex()).toBe(0x808080); // original untouched
    expect(tinted.color.r).toBeGreaterThan(originalMaterial.color.r); // blended toward red
  });

  it("tints a material whose name matches a hair hint", () => {
    const mesh = createFakeMesh("HairBack001");
    const vrm = createFakeVrm([mesh]);

    applyMaterialTints(vrm, { hairColorHex: "#3B7FC4" });

    const tinted = mesh.material as THREE.MeshStandardMaterial;
    expect(tinted.color.b).toBeGreaterThan(tinted.color.r); // blended toward blue
  });

  it("matches hints case-insensitively as a substring", () => {
    const mesh = createFakeMesh("N00_000_00_FACE_00_SKIN");
    const vrm = createFakeVrm([mesh]);

    applyMaterialTints(vrm, { skinToneHex: "#00ff00" });

    const tinted = mesh.material as THREE.MeshStandardMaterial;
    expect(tinted.color.g).toBeGreaterThan(0.5);
  });

  it("leaves a non-matching material untouched and warns exactly once per channel", () => {
    const mesh = createFakeMesh("Eyebrow");
    const originalMaterial = mesh.material;
    const vrm = createFakeVrm([mesh]);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    applyMaterialTints(vrm, { skinToneHex: "#ff0000", hairColorHex: "#0000ff" });

    expect(mesh.material).toBe(originalMaterial); // never crashes, never touches a non-match
    expect(warnSpy).toHaveBeenCalledTimes(2); // one warning for skin, one for hair
    warnSpy.mockRestore();
  });

  it("a failed skin match does not block a successful hair match, and vice versa", () => {
    const skinMesh = createFakeMesh("Body");
    const hairMesh = createFakeMesh("Hair");
    const vrm = createFakeVrm([skinMesh, hairMesh]);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Only hair hints match anything real here — skin hint list is empty.
    applyMaterialTints(vrm, { skinToneHex: "#ff0000", hairColorHex: "#0000ff", skinMaterialNameHints: ["nonexistent"] });

    expect(warnSpy).toHaveBeenCalledTimes(1); // only the skin channel warns
    expect((hairMesh.material as THREE.MeshStandardMaterial).color.b).toBeGreaterThan(0.5);
    warnSpy.mockRestore();
  });

  it("does nothing (no crash, no warning) when neither skinToneHex nor hairColorHex is provided", () => {
    const mesh = createFakeMesh("Body");
    const originalMaterial = mesh.material;
    const vrm = createFakeVrm([mesh]);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => applyMaterialTints(vrm, {})).not.toThrow();
    expect(mesh.material).toBe(originalMaterial);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("skips non-mesh nodes without throwing", () => {
    const vrm = {
      scene: {
        traverse: (callback: (node: THREE.Object3D) => void) => callback({ isMesh: false } as unknown as THREE.Object3D),
      },
    } as unknown as VRM;

    expect(() => applyMaterialTints(vrm, { skinToneHex: "#ff0000" })).not.toThrow();
  });
});
