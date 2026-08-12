import { prisma, type OrgBrandingResult, type OrgBrandingUpdateInput } from "@avatrain/shared";
import { toOrgResult } from "../lib/org-result.js";

/**
 * No withOrg wrapper — "organizations" is RLS-exempt (tenant root, not
 * tenant-scoped business data), same reasoning as auth-service.ts's me()
 * doing a direct prisma.organization.findUniqueOrThrow. The route's
 * requireRole("OWNER") guard plus deriving orgId from authContext (never
 * the request body) is what keeps this scoped to the caller's own org.
 */
export async function updateBranding(
  orgId: string,
  input: OrgBrandingUpdateInput,
): Promise<OrgBrandingResult> {
  const org = await prisma.organization.update({
    where: { id: orgId },
    data: input,
  });
  return toOrgResult(org);
}
