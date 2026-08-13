import { prisma, withAuthContext, withOrg, type OnboardingDraftInput } from "@avatrain/shared";
import type { Avatar } from "@prisma/client";
import { conflict } from "../lib/http-errors.js";
import { resolveSimliFaceId } from "../lib/simli.js";
import { assertAvatarComplete, withRecomputedSimliFaceId } from "../lib/avatar-persona.js";

export interface OnboardingDraftResult {
  name: string | null;
  style: Avatar["style"];
  gender: Avatar["gender"];
  skinTone: string | null;
  hairStyle: Avatar["hairStyle"];
  hairColor: string | null;
  outfit: Avatar["outfit"];
  expertise: Avatar["expertise"];
  voice: Avatar["voice"];
  ageGroup: Avatar["ageGroup"];
  region: Avatar["region"];
  preferredLanguage: Avatar["preferredLanguage"];
  status: Avatar["status"];
  lastVisitedStep: number;
  previewProvider: Avatar["previewProvider"];
  externalAvatarId: string | null;
  avatarModelUrl: string | null;
  avatarSnapshotUrl: string | null;
  previewGeneratedAt: string | null;
  simliFaceId: string | null;
}

function toDraftResult(avatar: Avatar): OnboardingDraftResult {
  return {
    name: avatar.name,
    style: avatar.style,
    gender: avatar.gender,
    skinTone: avatar.skinTone,
    hairStyle: avatar.hairStyle,
    hairColor: avatar.hairColor,
    outfit: avatar.outfit,
    expertise: avatar.expertise,
    voice: avatar.voice,
    ageGroup: avatar.ageGroup,
    region: avatar.region,
    preferredLanguage: avatar.preferredLanguage,
    status: avatar.status,
    lastVisitedStep: avatar.lastVisitedStep,
    previewProvider: avatar.previewProvider,
    externalAvatarId: avatar.externalAvatarId,
    avatarModelUrl: avatar.avatarModelUrl,
    avatarSnapshotUrl: avatar.avatarSnapshotUrl,
    previewGeneratedAt: avatar.previewGeneratedAt?.toISOString() ?? null,
    simliFaceId: avatar.simliFaceId,
  };
}

// Onboarding is a one-time gate, not a general Avatar editor — once
// User.onboardingCompletedAt is set, GET/PATCH must not touch the draft
// anymore. See .claude/specs/onboarding.md's API Changes.
async function assertNotCompleted(userId: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.onboardingCompletedAt) throw conflict("draft_already_completed");
}

async function findOrCreateDraftRow(
  orgId: string,
  userId: string,
): Promise<Avatar> {
  return withOrg(orgId, async (tx) => {
    const existing = await tx.avatar.findFirst({
      where: { orgId, createdById: userId, status: "DRAFT" },
    });
    if (existing) return existing;
    // Gender is always null at creation (nothing's been chosen yet) — this
    // resolves to the base SIMLI_FACE_ID fallback. Recomputed by updateDraft
    // below whenever gender is actually set/changed. See
    // prisma/schema.prisma's Avatar.simliFaceId doc comment.
    const simliFaceId = resolveSimliFaceId(null);
    return tx.avatar.create({ data: { orgId, createdById: userId, simliFaceId } });
  });
}

/**
 * Resolves the caller's own persisted Simli face — prefers a completed
 * (ACTIVE) Avatar, falling back to an in-progress DRAFT (so the builder's
 * live preview and a real training session both resolve the exact same
 * face for the exact same person, via one shared code path, never trusting
 * a client-supplied faceId). Read-only — never creates a draft as a side
 * effect. See routes/conversations.ts's simli-session endpoint.
 */
export async function getCallerSimliFaceId(orgId: string, userId: string): Promise<string | null> {
  return withOrg(orgId, async (tx) => {
    const active = await tx.avatar.findFirst({ where: { orgId, createdById: userId, status: "ACTIVE" } });
    if (active) return active.simliFaceId;
    const draft = await tx.avatar.findFirst({ where: { orgId, createdById: userId, status: "DRAFT" } });
    return draft?.simliFaceId ?? null;
  });
}

/** GET /v1/onboarding — get-or-create semantics, always returns a draft. */
export async function getOrCreateDraft(orgId: string, userId: string): Promise<OnboardingDraftResult> {
  await assertNotCompleted(userId);
  const draft = await findOrCreateDraftRow(orgId, userId);
  return toDraftResult(draft);
}

/**
 * PATCH /v1/onboarding — partial update, any subset of fields. Does not
 * require full-step completeness; that's POST /complete's job. Get-or-create
 * here too so a client can PATCH before its first GET has resolved without
 * a spurious 404.
 */
export async function updateDraft(
  orgId: string,
  userId: string,
  patch: OnboardingDraftInput,
): Promise<OnboardingDraftResult> {
  await assertNotCompleted(userId);
  const draft = await findOrCreateDraftRow(orgId, userId);
  // Recompute whenever gender changes, so the builder's live avatar and a
  // real training session both pick up the newly-selected gender's face —
  // not just whatever was resolved once at draft creation (when gender was
  // still null). See lib/avatar-persona.ts's withRecomputedSimliFaceId.
  const data = withRecomputedSimliFaceId(patch);
  const updated = await withOrg(orgId, (tx) => tx.avatar.update({ where: { id: draft.id }, data }));
  return toDraftResult(updated);
}

/**
 * POST /v1/onboarding/complete — server re-validates against the persisted
 * draft, never trusting client-supplied state (client-side step gating is a
 * UX convenience only). The 4 preview fields are never part of this
 * validation — see avatar-builder-customization.md's Implementation Rules.
 */
export async function completeDraft(orgId: string, userId: string): Promise<{ avatarId: string }> {
  await assertNotCompleted(userId);
  const draft = await findOrCreateDraftRow(orgId, userId);

  assertAvatarComplete(draft, "incomplete_onboarding");

  // Single transaction, both under one auth context: "avatars" needs
  // app.current_org_id set (RLS), "users" is RLS-exempt but still scoped to
  // this same transaction for atomicity — a crash between the two updates
  // must not leave status=ACTIVE with onboardingCompletedAt still null (or
  // vice versa).
  await withAuthContext({ userId, orgId }, async (tx) => {
    await tx.avatar.update({ where: { id: draft.id }, data: { status: "ACTIVE" } });
    await tx.user.update({ where: { id: userId }, data: { onboardingCompletedAt: new Date() } });
  });

  return { avatarId: draft.id };
}
