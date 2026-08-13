import { describe, expect, it } from "vitest";
import { vrmModelPath, placeholderVrmModelPath } from "./vrm-model-path.js";

describe("vrmModelPath / placeholderVrmModelPath", () => {
  it("builds a path from the replica id, mirroring idle-clip-path.ts's convention", () => {
    expect(vrmModelPath("realistic-female-business_formal")).toBe("/avatars/vrm/realistic-female-business_formal.vrm");
  });

  it("has a single, always-present placeholder path", () => {
    expect(placeholderVrmModelPath()).toBe("/avatars/vrm/_placeholder.vrm");
  });
});
