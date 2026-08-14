import { describe, expect, it } from "vitest";
import { hexColorSchema, orgBrandingUpdateSchema, orgLogoUrlSchema, orgNameSchema, organizationPlanSchema } from "./schema.js";

describe("hexColorSchema", () => {
  it("accepts a well-formed 6-digit hex color", () => {
    expect(hexColorSchema.safeParse("#8B5CF6").success).toBe(true);
  });

  it("accepts lowercase hex digits", () => {
    expect(hexColorSchema.safeParse("#8b5cf6").success).toBe(true);
  });

  it("rejects a 3-digit shorthand hex color", () => {
    expect(hexColorSchema.safeParse("#8b5").success).toBe(false);
  });

  it("rejects a color missing the leading #", () => {
    expect(hexColorSchema.safeParse("8b5cf6").success).toBe(false);
  });

  it("rejects a non-hex value", () => {
    expect(hexColorSchema.safeParse("not-a-color").success).toBe(false);
  });
});

describe("orgLogoUrlSchema", () => {
  it("accepts a well-formed https URL", () => {
    expect(orgLogoUrlSchema.safeParse("https://cdn.example.com/logo.png").success).toBe(true);
  });

  it("rejects a bare string that isn't a URL", () => {
    expect(orgLogoUrlSchema.safeParse("not-a-url").success).toBe(false);
  });
});

describe("orgNameSchema", () => {
  it("accepts a normal org name", () => {
    expect(orgNameSchema.safeParse("SPM Global Ventures").success).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(orgNameSchema.safeParse("").success).toBe(false);
  });

  it("rejects a whitespace-only string", () => {
    expect(orgNameSchema.safeParse("   ").success).toBe(false);
  });
});

describe("orgBrandingUpdateSchema", () => {
  it("accepts an empty object — every field is optional", () => {
    expect(orgBrandingUpdateSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a partial update with only colors set", () => {
    const result = orgBrandingUpdateSchema.safeParse({
      primaryColorHex: "#8B5CF6",
      secondaryColorHex: "#3B82F6",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a full update", () => {
    const result = orgBrandingUpdateSchema.safeParse({
      name: "Acme Corp",
      logoUrl: "https://cdn.example.com/logo.png",
      primaryColorHex: "#8B5CF6",
      secondaryColorHex: "#3B82F6",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid color while other fields are valid", () => {
    const result = orgBrandingUpdateSchema.safeParse({
      name: "Acme Corp",
      primaryColorHex: "purple",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown extra fields being silently trusted as name/logo overrides", () => {
    // Not a strict() schema, so unknown keys are stripped, not rejected —
    // asserting the parsed result never carries them through, since a
    // caller might otherwise assume rejection.
    const result = orgBrandingUpdateSchema.parse({ orgId: "should-be-ignored", name: "Acme" });
    expect(result).toEqual({ name: "Acme" });
  });
});

describe("organizationPlanSchema", () => {
  it("accepts each of the three plan values", () => {
    expect(organizationPlanSchema.safeParse("STARTER").success).toBe(true);
    expect(organizationPlanSchema.safeParse("PRO").success).toBe(true);
    expect(organizationPlanSchema.safeParse("ENTERPRISE").success).toBe(true);
  });

  it("rejects an arbitrary string", () => {
    expect(organizationPlanSchema.safeParse("PREMIUM").success).toBe(false);
  });

  it("rejects a lowercase value", () => {
    expect(organizationPlanSchema.safeParse("enterprise").success).toBe(false);
  });
});
