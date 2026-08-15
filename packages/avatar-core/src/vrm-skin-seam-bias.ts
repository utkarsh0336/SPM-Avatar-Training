import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";

const SKIN_MATERIAL_NAME_HINTS = ["skin", "face", "body", "ears", "lips", "fingernails"];

/**
 * Nudges skin/body materials backward in the depth buffer via polygonOffset
 * so clothing meshes reliably win the depth test at seams where the garment
 * mesh sits almost flush against the underlying body mesh (collar, cuffs,
 * neckline) — those near-coincident surfaces z-fight into a torn/noisy edge
 * otherwise. Independent of vrm-material-tint.ts's skin-hint matching
 * (which only clones/recolors materials when a skin tone is actually
 * configured) — this needs to run unconditionally, every load, regardless
 * of whether tinting is in use.
 */
export function applySkinSeamBias(vrm: VRM): void {
  vrm.scene.traverse((node: THREE.Object3D) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      const name = (material.name ?? "").toLowerCase();
      if (!SKIN_MATERIAL_NAME_HINTS.some((hint) => name.includes(hint))) continue;
      material.polygonOffset = true;
      material.polygonOffsetFactor = 1;
      material.polygonOffsetUnits = 1;
    }
  });
}
