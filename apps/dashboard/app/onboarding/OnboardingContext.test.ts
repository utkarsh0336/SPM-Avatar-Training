import { describe, expect, it } from "vitest";
import type { OnboardingDraftResponse } from "@avatrain/shared/onboarding";
import { buildPatchPayload, mergeDraftIntoState, OnboardingProvider, useOnboarding } from "./OnboardingContext";
import { INITIAL_ONBOARDING_STATE } from "./types";

const EMPTY_DRAFT: OnboardingDraftResponse = {
  name: null,
  style: null,
  gender: null,
  skinTone: null,
  hairStyle: null,
  hairColor: null,
  outfit: null,
  expertise: null,
  voice: null,
  status: "DRAFT",
  lastVisitedStep: 1,
  previewProvider: "NONE",
  externalAvatarId: null,
  avatarModelUrl: null,
  avatarSnapshotUrl: null,
  previewGeneratedAt: null,
  simliFaceId: null,
};

describe("OnboardingProvider / useOnboarding", () => {
  it("are exported as functions", () => {
    expect(typeof OnboardingProvider).toBe("function");
    expect(typeof useOnboarding).toBe("function");
  });
});

describe("mergeDraftIntoState", () => {
  it("keeps client defaults when the server draft is entirely unset (fresh draft)", () => {
    const merged = mergeDraftIntoState(INITIAL_ONBOARDING_STATE, EMPTY_DRAFT);
    expect(merged.gender).toBe(INITIAL_ONBOARDING_STATE.gender);
    expect(merged.skinTone).toBe(INITIAL_ONBOARDING_STATE.skinTone);
    expect(merged.style).toBeNull();
  });

  it("prefers a server-known value over the client default (returning user)", () => {
    const draft: OnboardingDraftResponse = {
      ...EMPTY_DRAFT,
      name: "Saved Avatar",
      style: "ANIMATED",
      gender: "MALE",
      skinTone: "TONE_5",
    };
    const merged = mergeDraftIntoState(INITIAL_ONBOARDING_STATE, draft);
    expect(merged.name).toBe("Saved Avatar");
    expect(merged.style).toBe("ANIMATED");
    expect(merged.gender).toBe("MALE");
    expect(merged.skinTone).toBe("TONE_5");
  });

  it("carries through the additive preview fields verbatim", () => {
    const draft: OnboardingDraftResponse = {
      ...EMPTY_DRAFT,
      previewProvider: "READY_PLAYER_ME",
      externalAvatarId: "rpm-42",
      avatarModelUrl: "https://models.readyplayer.me/abc.glb",
    };
    const merged = mergeDraftIntoState(INITIAL_ONBOARDING_STATE, draft);
    expect(merged.previewProvider).toBe("READY_PLAYER_ME");
    expect(merged.externalAvatarId).toBe("rpm-42");
    expect(merged.avatarModelUrl).toBe("https://models.readyplayer.me/abc.glb");
  });

  it("carries through the server-pinned simliFaceId", () => {
    const draft: OnboardingDraftResponse = { ...EMPTY_DRAFT, simliFaceId: "face-abc123" };
    const merged = mergeDraftIntoState(INITIAL_ONBOARDING_STATE, draft);
    expect(merged.simliFaceId).toBe("face-abc123");
  });
});

describe("buildPatchPayload", () => {
  it("omits name and style when they're still at their unset defaults", () => {
    const payload = buildPatchPayload(INITIAL_ONBOARDING_STATE);
    expect(payload).not.toHaveProperty("name");
    expect(payload).not.toHaveProperty("style");
    expect(payload.gender).toBe(INITIAL_ONBOARDING_STATE.gender);
  });

  it("includes name once it's long enough, and style once it's chosen", () => {
    const payload = buildPatchPayload({ ...INITIAL_ONBOARDING_STATE, name: "Ava", style: "REALISTIC" });
    expect(payload.name).toBe("Ava");
    expect(payload.style).toBe("REALISTIC");
  });

  it("omits the too-short name a single character produces", () => {
    const payload = buildPatchPayload({ ...INITIAL_ONBOARDING_STATE, name: "A" });
    expect(payload).not.toHaveProperty("name");
  });

  it("omits all 4 preview fields while previewProvider is NONE", () => {
    const payload = buildPatchPayload({
      ...INITIAL_ONBOARDING_STATE,
      avatarModelUrl: "https://models.readyplayer.me/abc.glb",
    });
    expect(payload).not.toHaveProperty("previewProvider");
    expect(payload).not.toHaveProperty("avatarModelUrl");
  });

  it("includes the preview fields once previewProvider is set", () => {
    const payload = buildPatchPayload({
      ...INITIAL_ONBOARDING_STATE,
      previewProvider: "READY_PLAYER_ME",
      externalAvatarId: "rpm-42",
      avatarModelUrl: "https://models.readyplayer.me/abc.glb",
    });
    expect(payload.previewProvider).toBe("READY_PLAYER_ME");
    expect(payload.externalAvatarId).toBe("rpm-42");
    expect(payload.avatarModelUrl).toBe("https://models.readyplayer.me/abc.glb");
  });
});
