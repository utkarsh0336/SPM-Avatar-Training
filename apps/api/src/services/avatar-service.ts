import { withOrg, type AvatarSummary, type AvatarRecord, type OnboardingDraftInput } from "@avatrain/shared";
import type { Avatar } from "@prisma/client";
import { conflict, notFound } from "../lib/http-errors.js";
import { assertAvatarComplete, withRecomputedSimliFaceId } from "../lib/avatar-persona.js";
import { resolveSimliFaceId } from "../lib/simli.js";

// Abuse-prevention ceiling, not a real billing entitlement — flagged as
// such in the plan this shipped from. Revisit once persona limits become an
// actual product/pricing decision (ties to CLAUDE.md's "Plan first for:
// Billing").
const MAX_AVATARS_PER_ORG = 20;

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
      programType: avatar.curriculum?.programType ?? null,
    }));
  });
}

function toAvatarRecord(avatar: Avatar): AvatarRecord {
  return {
    id: avatar.id,
    name: avatar.name,
    style: avatar.style,
    gender: avatar.gender,
    // Casts, not validation — avatars.skin_tone/hair_color are plain TEXT
    // columns (application-layer allowlist, see schema.prisma's doc
    // comment), wider than AvatarRecord's schema-derived literal union.
    // Same convention as apps/dashboard/app/onboarding/OnboardingContext.tsx's
    // buildPatchPayload. The client's getAvatarResponseSchema.parse() is
    // what actually enforces the allowlist.
    skinTone: avatar.skinTone as AvatarRecord["skinTone"],
    hairStyle: avatar.hairStyle,
    hairColor: avatar.hairColor as AvatarRecord["hairColor"],
    outfit: avatar.outfit,
    expertise: avatar.expertise,
    voice: avatar.voice,
    ageGroup: avatar.ageGroup,
    region: avatar.region,
    preferredLanguage: avatar.preferredLanguage,
    readingLevel: avatar.readingLevel,
    status: avatar.status,
    simliFaceId: avatar.simliFaceId,
  };
}

/**
 * GET /v1/avatars/mine — every non-archived avatar the caller has created,
 * ACTIVE ones first (then most-recently-created within each status) —
 * mirrors onboarding-service.ts's getCallerSimliFaceId's
 * ACTIVE-preferred-over-DRAFT ordering. Feeds a live session's persona
 * resolution (useConversationSession.ts), replacing the old localStorage
 * handoff — see .claude/specs/avatar-builder-customization.md's
 * Implementation Assumptions #5. ARCHIVED avatars are excluded — a
 * soft-deleted persona must never be picked as "the" avatar for a new
 * session; use listOrgAvatars (GET /v1/avatars/all) to see them.
 */
export async function getMyAvatars(orgId: string, userId: string): Promise<AvatarRecord[]> {
  return withOrg(orgId, async (tx) => {
    const avatars = await tx.avatar.findMany({
      where: { orgId, createdById: userId, status: { not: "ARCHIVED" } },
      orderBy: { createdAt: "desc" },
    });
    const statusRank = (status: Avatar["status"]): number => (status === "ACTIVE" ? 0 : 1);
    return avatars
      .slice()
      .sort((a, b) => statusRank(a.status) - statusRank(b.status)) // stable sort — createdAt desc preserved within each status
      .map(toAvatarRecord);
  });
}

/**
 * GET /v1/avatars/all — OWNER-only, every avatar in the org regardless of
 * status (including ARCHIVED, so the management page can offer "restore").
 * Powers apps/dashboard/app/avatars' persona list — distinct from
 * listActiveAvatars (Curriculum's minimal ACTIVE-only picker) and
 * getMyAvatars (a live session's own-persona resolution), neither of which
 * fit a full org-wide management view.
 */
export async function listOrgAvatars(orgId: string): Promise<AvatarRecord[]> {
  return withOrg(orgId, async (tx) => {
    const avatars = await tx.avatar.findMany({ where: { orgId }, orderBy: { createdAt: "desc" } });
    return avatars.map(toAvatarRecord);
  });
}

/**
 * GET /v1/avatars/:avatarId — any org member may read any of the org's own
 * avatars (not scoped to the caller's createdById — a session or a future
 * persona picker needs to resolve avatars other than "my own"). RLS still
 * enforces org isolation; withOrg is what makes that enforceable here.
 * Includes curriculumId (unlike getMyAvatars/listOrgAvatars) — a live
 * rehearsal session only knows its avatarId, and
 * .claude/specs/induction-checklist.md's ChecklistPanel needs to resolve
 * the curriculum from it.
 */
export async function getAvatarById(orgId: string, avatarId: string): Promise<AvatarRecord | null> {
  return withOrg(orgId, async (tx) => {
    const avatar = await tx.avatar.findFirst({ where: { orgId, id: avatarId }, include: { curriculum: true } });
    return avatar ? { ...toAvatarRecord(avatar), curriculumId: avatar.curriculum?.id ?? null } : null;
  });
}

/**
 * POST /v1/avatars — OWNER-only. Creates a blank DRAFT persona, deliberately
 * NOT gated by onboarding-service.ts's assertNotCompleted (that gate exists
 * for the one-time wizard only — persona CRUD is ungated by it). 409s past
 * MAX_AVATARS_PER_ORG, counting every non-archived avatar so an org can't
 * work around the ceiling by leaving drafts open forever; archiving one
 * frees a slot.
 */
export async function createAvatar(orgId: string, userId: string, name?: string): Promise<AvatarRecord> {
  return withOrg(orgId, async (tx) => {
    const existingCount = await tx.avatar.count({ where: { orgId, status: { not: "ARCHIVED" } } });
    if (existingCount >= MAX_AVATARS_PER_ORG) {
      throw conflict("avatar_limit_reached", `An org may have at most ${MAX_AVATARS_PER_ORG} active/draft avatars.`);
    }
    // Gender is null at creation — resolves to the base SIMLI_FACE_ID
    // fallback, recomputed on the first PATCH that sets a gender. Same
    // convention as onboarding-service.ts's findOrCreateDraftRow.
    const simliFaceId = resolveSimliFaceId(null);
    const avatar = await tx.avatar.create({ data: { orgId, createdById: userId, name, simliFaceId } });
    return toAvatarRecord(avatar);
  });
}

/**
 * PATCH /v1/avatars/:avatarId — OWNER-only. Partial update, any subset of
 * OnboardingDraftInput's fields — reuses the wizard's own PATCH shape
 * rather than defining a second one, since the fields are identical.
 * Recomputes simliFaceId on a gender change, same as onboarding's
 * updateDraft, via the shared lib/avatar-persona.ts helper.
 */
export async function updateAvatar(
  orgId: string,
  avatarId: string,
  patch: OnboardingDraftInput,
): Promise<AvatarRecord> {
  return withOrg(orgId, async (tx) => {
    const existing = await tx.avatar.findFirst({ where: { orgId, id: avatarId } });
    if (!existing) throw notFound("avatar_not_found");
    const data = withRecomputedSimliFaceId(patch);
    const updated = await tx.avatar.update({ where: { id: avatarId }, data });
    return toAvatarRecord(updated);
  });
}

/**
 * POST /v1/avatars/:avatarId/publish — OWNER-only. Validates every field
 * onboarding.md's original 6 steps require (assertAvatarComplete, shared
 * with onboarding-service.ts's completeDraft) and sets status ACTIVE.
 * Works from any prior status, including ARCHIVED — this is also how an
 * archived persona gets restored, rather than a separate "un-archive"
 * action (it must still be complete to come back).
 */
export async function publishAvatar(orgId: string, avatarId: string): Promise<AvatarRecord> {
  return withOrg(orgId, async (tx) => {
    const existing = await tx.avatar.findFirst({ where: { orgId, id: avatarId } });
    if (!existing) throw notFound("avatar_not_found");
    assertAvatarComplete(existing, "incomplete_avatar");
    const updated = await tx.avatar.update({ where: { id: avatarId }, data: { status: "ACTIVE" } });
    return toAvatarRecord(updated);
  });
}

/**
 * POST /v1/avatars/:avatarId/archive — OWNER-only. Soft-delete: sets status
 * ARCHIVED rather than removing the row, since Curriculum.avatarId is a
 * required @unique FK with no onDelete behavior — a hard delete on an
 * avatar with a curriculum would throw a raw FK-violation. Works from any
 * prior status; archiving an already-DRAFT avatar (never published) is a
 * legitimate way to clean up an abandoned persona too.
 */
export async function archiveAvatar(orgId: string, avatarId: string): Promise<AvatarRecord> {
  return withOrg(orgId, async (tx) => {
    const existing = await tx.avatar.findFirst({ where: { orgId, id: avatarId } });
    if (!existing) throw notFound("avatar_not_found");
    const updated = await tx.avatar.update({ where: { id: avatarId }, data: { status: "ARCHIVED" } });
    return toAvatarRecord(updated);
  });
}
