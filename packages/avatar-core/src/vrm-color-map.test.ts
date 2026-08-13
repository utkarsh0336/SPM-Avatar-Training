import { describe, expect, it } from "vitest";
import { SKIN_TONE_HEX, HAIR_COLOR_HEX } from "./vrm-color-map.js";

// Drift guard against packages/shared/src/tutor/avatar-config.ts's
// SKIN_TONE_HEX/HAIR_COLOR_HEX — see this file's own doc comment for why
// this is a duplicate, not a live import. Update both together.
describe("SKIN_TONE_HEX / HAIR_COLOR_HEX", () => {
  it("matches @avatrain/shared's skin tone tokens and hex values", () => {
    expect(SKIN_TONE_HEX).toEqual({
      TONE_1: "#F7DFC4",
      TONE_2: "#EFC9A2",
      TONE_3: "#DCA477",
      TONE_4: "#BE8148",
      TONE_5: "#9C6432",
      TONE_6: "#7A4A24",
    });
  });

  it("matches @avatrain/shared's hair color tokens and hex values", () => {
    expect(HAIR_COLOR_HEX).toEqual({
      BLACK: "#2B2724",
      AUBURN: "#7A4020",
      COPPER: "#A5622F",
      BLONDE: "#D4A83C",
      PLATINUM: "#EDE0C8",
      RED: "#C43B2C",
      PURPLE: "#7B3FA0",
      BLUE: "#3B7FC4",
    });
  });
});
