import { describe, expect, it } from "vitest";
import { GESTURE_BONE_NAMES, GESTURE_PRESETS, type GestureBoneName } from "./gesture-presets.js";

// vrm-idle-animator.ts owns head/neck bones and the blink/lookLeft/
// lookRight/lookUp/lookDown expression names — a gesture preset must never
// reference any of them. TypeScript's GestureBoneName already prevents this
// at compile time; this test is a runtime regression guard in case that
// type is ever loosened.
const DISALLOWED_BONE_NAMES = ["head", "neck"];

describe("GESTURE_PRESETS", () => {
  it("only references bones in GESTURE_BONE_NAMES", () => {
    for (const [phase, preset] of Object.entries(GESTURE_PRESETS)) {
      for (const boneName of Object.keys(preset)) {
        expect(
          GESTURE_BONE_NAMES.includes(boneName as GestureBoneName),
          `${phase} preset references unknown bone "${boneName}"`,
        ).toBe(true);
      }
    }
  });

  it("never references an idle-animator-owned bone", () => {
    for (const [phase, preset] of Object.entries(GESTURE_PRESETS)) {
      for (const boneName of Object.keys(preset)) {
        expect(
          DISALLOWED_BONE_NAMES.includes(boneName),
          `${phase} preset references idle-animator-owned bone "${boneName}"`,
        ).toBe(false);
      }
    }
  });

  it("defines a preset for every GesturePhase", () => {
    expect(Object.keys(GESTURE_PRESETS).sort()).toEqual(["listening", "speaking", "thinking"]);
  });
});
