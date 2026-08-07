import { describe, expect, it } from "vitest";
import { readOnboardingAvatarHandoff, writeOnboardingAvatarHandoff, type OnboardingHandoffStorage } from "./onboarding-handoff.js";
import { INITIAL_ONBOARDING_STATE, type OnboardingState } from "../app/onboarding/types.js";

function createFakeStorage(): OnboardingHandoffStorage & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

const completedState: OnboardingState = {
  ...INITIAL_ONBOARDING_STATE,
  style: "REALISTIC",
  name: "Nancy",
};

describe("onboarding-handoff", () => {
  it("writes then reads back the same avatar config", () => {
    const storage = createFakeStorage();
    writeOnboardingAvatarHandoff(completedState, storage);
    expect(readOnboardingAvatarHandoff(storage)).toEqual({
      style: "REALISTIC",
      gender: completedState.gender,
      outfit: completedState.outfit,
      name: "Nancy",
      expertise: completedState.expertise,
      voice: completedState.voice,
    });
  });

  it("drops presentation-only fields (skinTone/hairStyle/hairColor)", () => {
    const storage = createFakeStorage();
    writeOnboardingAvatarHandoff(completedState, storage);
    const raw = JSON.parse(storage.store.get("avatrain:onboarding-handoff")!);
    expect(raw).not.toHaveProperty("skinTone");
    expect(raw).not.toHaveProperty("hairStyle");
    expect(raw).not.toHaveProperty("hairColor");
  });

  it("does not write anything when style was never chosen (step 1 incomplete)", () => {
    const storage = createFakeStorage();
    writeOnboardingAvatarHandoff({ ...completedState, style: null }, storage);
    expect(storage.store.size).toBe(0);
  });

  it("returns null when nothing has been written", () => {
    const storage = createFakeStorage();
    expect(readOnboardingAvatarHandoff(storage)).toBeNull();
  });

  it("returns null (not a throw) for corrupt JSON", () => {
    const storage = createFakeStorage();
    storage.setItem("avatrain:onboarding-handoff", "{not json");
    expect(readOnboardingAvatarHandoff(storage)).toBeNull();
  });

  it("returns null (not a throw) for JSON that fails schema validation", () => {
    const storage = createFakeStorage();
    storage.setItem("avatrain:onboarding-handoff", JSON.stringify({ style: "NOT_A_REAL_STYLE" }));
    expect(readOnboardingAvatarHandoff(storage)).toBeNull();
  });

  it("does not throw when storage itself throws (e.g. private browsing quota)", () => {
    const throwingStorage: OnboardingHandoffStorage = {
      getItem: () => {
        throw new Error("quota exceeded");
      },
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };
    expect(() => writeOnboardingAvatarHandoff(completedState, throwingStorage)).not.toThrow();
    expect(() => readOnboardingAvatarHandoff(throwingStorage)).not.toThrow();
    expect(readOnboardingAvatarHandoff(throwingStorage)).toBeNull();
  });
});
