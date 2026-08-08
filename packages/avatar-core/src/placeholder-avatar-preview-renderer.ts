import type { AvatarPreviewConfig, AvatarPreviewRenderer } from "./avatar-preview-renderer.js";

export interface PlaceholderAvatarPreviewRendererOptions {
  /** Injectable for tests; defaults to document.createElement. */
  createElement?: (tag: string) => HTMLElement;
}

// Modest, gender-derived gradient so the placeholder never renders as a
// flat blank box — same idea as onboarding's LivePreviewPanel, kept
// independent of it per this file's decoupling rule (see
// avatar-preview-renderer.ts's doc comment).
const GENDER_GRADIENTS: Record<string, string> = {
  FEMALE: "linear-gradient(160deg, #c9793f 0%, #3a3350 55%, #1c2333 100%)",
  MALE: "linear-gradient(160deg, #4a5b73 0%, #2b3245 55%, #1c2333 100%)",
  NEUTRAL: "linear-gradient(160deg, #6d4fa0 0%, #382f52 55%, #1c2333 100%)",
};
const DEFAULT_GRADIENT = GENDER_GRADIENTS.NEUTRAL!;

/**
 * The $0 default AvatarPreviewRenderer implementation — a colored gradient
 * placeholder, upgrading to a plain <img> once a vendor-provided flat
 * snapshot (avatarSnapshotUrl) exists. Deliberately does not attempt to
 * render avatarModelUrl (typically a GLB binary) — a 3D viewer dependency is
 * explicitly deferred, see avatar-builder-customization.md Implementation
 * Assumptions #4.
 */
export function createPlaceholderAvatarPreviewRenderer(
  options: PlaceholderAvatarPreviewRendererOptions = {},
): AvatarPreviewRenderer {
  const createElement = options.createElement ?? ((tag: string) => document.createElement(tag));

  let root: HTMLDivElement | null = null;
  let img: HTMLImageElement | null = null;

  function applyConfig(config: AvatarPreviewConfig): void {
    if (!root) return;
    root.style.background = GENDER_GRADIENTS[config.gender] ?? DEFAULT_GRADIENT;

    const snapshotUrl = config.previewProvider !== "NONE" ? config.avatarSnapshotUrl : null;
    if (snapshotUrl) {
      if (!img) {
        img = createElement("img") as HTMLImageElement;
        img.style.width = "100%";
        img.style.height = "100%";
        img.style.objectFit = "cover";
        root.appendChild(img);
      }
      img.src = snapshotUrl;
      img.style.display = "block";
    } else if (img) {
      img.style.display = "none";
    }
  }

  return {
    async render(config: AvatarPreviewConfig, container: HTMLElement): Promise<void> {
      root = createElement("div") as HTMLDivElement;
      root.style.width = "100%";
      root.style.height = "100%";
      container.appendChild(root);
      applyConfig(config);
    },

    update(config: AvatarPreviewConfig): void {
      applyConfig(config);
    },

    destroy(): void {
      root?.remove();
      root = null;
      img = null;
    },
  };
}
