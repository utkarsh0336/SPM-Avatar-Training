import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";

export interface MaterialTintConfig {
  skinToneHex?: string | null;
  hairColorHex?: string | null;
  /** Case-insensitive substring match against each material's .name — VRoid Studio's default export commonly produces names like "Body", "Face", "Hair001". */
  skinMaterialNameHints?: string[];
  hairMaterialNameHints?: string[];
  /** 0..1 blend strength toward the target color. Default 0.7 — not a flat replace, so baked shading/AO detail in the source texture survives. */
  strength?: number;
}

const DEFAULT_SKIN_HINTS = ["skin", "face", "body"];
const DEFAULT_HAIR_HINTS = ["hair"];
const DEFAULT_STRENGTH = 0.7;

function tintMaterial(material: THREE.Material, hex: string, strength: number): THREE.Material {
  // Clone before mutating — materials can be shared across multiple
  // concurrently-mounted VRM instances (e.g. an avatar list page rendering
  // several thumbnails at once); mutating a shared instance in place would
  // corrupt every other mesh using it.
  const cloned = material.clone();
  const colorable = cloned as THREE.Material & { color?: THREE.Color };
  colorable.color?.lerp(new THREE.Color(hex), strength);
  return cloned;
}

/**
 * Applies live color tints to a loaded VRM's skin and hair materials —
 * runtime tinting, not separate baked per-skin-tone model variants (a
 * fixed set of style/gender/outfit base models × 6 skin tones × 8 hair
 * colors would need up to 48x the hand-authored VRoid Studio assets and
 * couldn't be tuned interactively). Traverses every mesh material and
 * case-insensitive-substring-matches its name against the hint lists.
 *
 * Never crashes and never blocks the avatar from rendering: a channel with
 * zero matching meshes just warns and leaves that part's default coloring
 * in place (mirrors replica-resolver.ts's warn-not-throw convention). Each
 * channel is independent — a failed skin-tone match doesn't block hair.
 */
export function applyMaterialTints(vrm: VRM, config: MaterialTintConfig = {}): void {
  const skinHints = (config.skinMaterialNameHints ?? DEFAULT_SKIN_HINTS).map((hint) => hint.toLowerCase());
  const hairHints = (config.hairMaterialNameHints ?? DEFAULT_HAIR_HINTS).map((hint) => hint.toLowerCase());
  const strength = config.strength ?? DEFAULT_STRENGTH;

  let skinMatches = 0;
  let hairMatches = 0;

  vrm.scene.traverse((node: THREE.Object3D) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const tinted = materials.map((material) => {
      const name = (material.name ?? "").toLowerCase();
      if (config.skinToneHex && skinHints.some((hint) => name.includes(hint))) {
        skinMatches++;
        return tintMaterial(material, config.skinToneHex, strength);
      }
      if (config.hairColorHex && hairHints.some((hint) => name.includes(hint))) {
        hairMatches++;
        return tintMaterial(material, config.hairColorHex, strength);
      }
      return material;
    });

    mesh.material = Array.isArray(mesh.material) ? tinted : tinted[0]!;
  });

  if (config.skinToneHex && skinMatches === 0) {
    console.warn(
      `[vrm-material-tint] no material matched skin hints [${skinHints.join(", ")}] — leaving default skin coloring`,
    );
  }
  if (config.hairColorHex && hairMatches === 0) {
    console.warn(
      `[vrm-material-tint] no material matched hair hints [${hairHints.join(", ")}] — leaving default hair coloring`,
    );
  }
}
