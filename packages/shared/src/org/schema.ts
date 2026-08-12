import { z } from "zod";
// Same validation signup already uses for the org's name (min 1, max 200,
// trimmed) — reused rather than redefined to avoid two schemas silently
// drifting apart.
import { orgNameSchema } from "../auth/schemas.js";

export { orgNameSchema };

export const hexColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, "must be a 6-digit hex color, e.g. #8B5CF6");

export const orgLogoUrlSchema = z.string().url();

// PATCH /v1/org/branding body — every field optional so a partial update
// (e.g. colors only) never clobbers the others. See
// .claude/specs/tenant-branding.md's Implementation Rules: unset fields must
// leave existing values untouched, not null them out.
export const orgBrandingUpdateSchema = z.object({
  name: orgNameSchema.optional(),
  logoUrl: orgLogoUrlSchema.optional(),
  primaryColorHex: hexColorSchema.optional(),
  secondaryColorHex: hexColorSchema.optional(),
});

export type OrgBrandingUpdateInput = z.infer<typeof orgBrandingUpdateSchema>;

// Response shape for the org object everywhere it's returned — GET
// /v1/auth/me and every endpoint built from SessionResult/MeResult in
// apps/api/src/services/auth-service.ts, plus PATCH /v1/org/branding's
// response.
export const orgBrandingResultSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  logoUrl: z.string().nullable(),
  primaryColorHex: z.string().nullable(),
  secondaryColorHex: z.string().nullable(),
});

export type OrgBrandingResult = z.infer<typeof orgBrandingResultSchema>;
