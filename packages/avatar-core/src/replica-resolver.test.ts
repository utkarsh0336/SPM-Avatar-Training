import { describe, expect, it, vi } from "vitest";
import { resolveReplicaId } from "./replica-resolver.js";

describe("resolveReplicaId", () => {
  it("returns the exact match without warning", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const id = resolveReplicaId({ style: "REALISTIC", gender: "FEMALE", outfit: "BUSINESS_FORMAL" });
    expect(id).toBe("realistic-female-business_formal");
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("falls back to the nearest match by style+gender and warns", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const id = resolveReplicaId({ style: "REALISTIC", gender: "FEMALE", outfit: "TECH_CREATIVE" });
    expect(id).toBe("realistic-female-business_formal");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("falls back to the nearest match by style alone and warns", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const id = resolveReplicaId({ style: "ANIMATED", gender: "FEMALE", outfit: "BUSINESS_FORMAL" });
    expect(id).toBe("animated-neutral-tech_creative");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("falls back to the registry default when nothing matches even by style, and warns", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const id = resolveReplicaId({ style: "UNKNOWN_STYLE", gender: "MALE", outfit: "BUSINESS_FORMAL" });
    expect(id).toBe("realistic-female-business_formal");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("never throws for any input", () => {
    expect(() => resolveReplicaId({ style: "", gender: "", outfit: "" })).not.toThrow();
  });
});
