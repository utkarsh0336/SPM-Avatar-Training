import { describe, expect, it, vi } from "vitest";
import { createPlaceholderAvatarPreviewRenderer } from "./placeholder-avatar-preview-renderer.js";
import type { AvatarPreviewConfig } from "./avatar-preview-renderer.js";

function createFakeDiv() {
  return {
    style: {} as CSSStyleDeclaration,
    appendChild: vi.fn(),
    remove: vi.fn(),
  } as unknown as HTMLDivElement;
}

function createFakeImg() {
  return { style: {} as CSSStyleDeclaration, src: "" } as unknown as HTMLImageElement;
}

function createFakeContainer() {
  return { appendChild: vi.fn() } as unknown as HTMLElement;
}

const BASE_CONFIG: AvatarPreviewConfig = {
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

describe("createPlaceholderAvatarPreviewRenderer", () => {
  it("render() mounts a root div into the container with a gender-derived gradient", async () => {
    const div = createFakeDiv();
    const container = createFakeContainer();
    const renderer = createPlaceholderAvatarPreviewRenderer({
      createElement: () => div as unknown as HTMLElement,
    });

    await renderer.render(BASE_CONFIG, container);

    expect(container.appendChild).toHaveBeenCalledWith(div);
    expect(div.style.background).toContain("#c9793f");
  });

  it("update() changes the gradient when gender changes, without re-mounting", async () => {
    const div = createFakeDiv();
    const renderer = createPlaceholderAvatarPreviewRenderer({ createElement: () => div as unknown as HTMLElement });
    await renderer.render(BASE_CONFIG, createFakeContainer());

    renderer.update({ ...BASE_CONFIG, gender: "MALE" });

    expect(div.style.background).toContain("#4a5b73");
    expect(div.appendChild).not.toHaveBeenCalled();
  });

  it("stays a plain gradient while previewProvider is NONE, even with a snapshot URL set", async () => {
    const div = createFakeDiv();
    const renderer = createPlaceholderAvatarPreviewRenderer({ createElement: () => div as unknown as HTMLElement });
    await renderer.render(
      { ...BASE_CONFIG, avatarSnapshotUrl: "https://models.readyplayer.me/x.png" },
      createFakeContainer(),
    );

    expect(div.appendChild).not.toHaveBeenCalled();
  });

  it("upgrades to an <img> once previewProvider + avatarSnapshotUrl are set", async () => {
    let created: HTMLDivElement | HTMLImageElement;
    const div = createFakeDiv();
    const img = createFakeImg();
    const renderer = createPlaceholderAvatarPreviewRenderer({
      createElement: (tag: string) => {
        created = tag === "img" ? img : div;
        return created as unknown as HTMLElement;
      },
    });
    await renderer.render(BASE_CONFIG, createFakeContainer());

    renderer.update({
      ...BASE_CONFIG,
      previewProvider: "READY_PLAYER_ME",
      avatarSnapshotUrl: "https://models.readyplayer.me/x.png",
    });

    expect(img.src).toBe("https://models.readyplayer.me/x.png");
    expect(img.style.display).toBe("block");
    expect(div.appendChild).toHaveBeenCalledWith(img);
  });

  it("never treats avatarModelUrl (a GLB, not an image) as a displayable snapshot", async () => {
    const div = createFakeDiv();
    const renderer = createPlaceholderAvatarPreviewRenderer({ createElement: () => div as unknown as HTMLElement });
    await renderer.render(
      { ...BASE_CONFIG, previewProvider: "READY_PLAYER_ME", avatarModelUrl: "https://models.readyplayer.me/x.glb" },
      createFakeContainer(),
    );

    expect(div.appendChild).not.toHaveBeenCalled();
  });

  it("destroy() removes the root element", async () => {
    const div = createFakeDiv();
    const renderer = createPlaceholderAvatarPreviewRenderer({ createElement: () => div as unknown as HTMLElement });
    await renderer.render(BASE_CONFIG, createFakeContainer());

    renderer.destroy();

    expect(div.remove).toHaveBeenCalledTimes(1);
  });
});
