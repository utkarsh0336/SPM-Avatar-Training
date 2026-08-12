import type { OrgBrandingResult } from "@avatrain/shared";

/** Shared by auth-service.ts (every org-returning auth endpoint) and
 * org-service.ts (PATCH /v1/org/branding) so the response shape can't drift
 * between the two. See .claude/specs/tenant-branding.md. */
export function toOrgResult(org: {
  id: string;
  name: string;
  logoUrl: string | null;
  primaryColorHex: string | null;
  secondaryColorHex: string | null;
}): OrgBrandingResult {
  return {
    id: org.id,
    name: org.name,
    logoUrl: org.logoUrl,
    primaryColorHex: org.primaryColorHex,
    secondaryColorHex: org.secondaryColorHex,
  };
}
