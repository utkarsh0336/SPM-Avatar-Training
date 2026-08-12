import { withOrg, type AvatarSummary } from "@avatrain/shared";

/**
 * Minimal avatar listing — enables the Curriculum admin page's avatar
 * picker (see .claude/specs/interactive-assessment.md). Only ACTIVE
 * avatars (onboarding-service.ts's completeDraft is what sets that status)
 * are eligible: a curriculum belongs on a published avatar, not an
 * in-progress builder draft.
 */
export async function listActiveAvatars(orgId: string): Promise<AvatarSummary[]> {
  return withOrg(orgId, async (tx) => {
    const avatars = await tx.avatar.findMany({
      where: { orgId, status: "ACTIVE" },
      include: { curriculum: true },
      orderBy: { createdAt: "desc" },
    });
    return avatars.map((avatar) => ({
      id: avatar.id,
      name: avatar.name ?? "Untitled Avatar",
      curriculumId: avatar.curriculum?.id ?? null,
    }));
  });
}
