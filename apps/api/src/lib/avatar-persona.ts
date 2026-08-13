import { onboardingCompleteRequiredSchema, type OnboardingDraftInput } from "@avatrain/shared";
import type { Avatar } from "@prisma/client";
import { badRequest } from "./http-errors.js";
import { resolveSimliFaceId, type SimliGender } from "./simli.js";

/**
 * Recomputes simliFaceId whenever a patch changes gender — shared by
 * onboarding-service.ts's updateDraft (the one-time wizard) and
 * avatar-service.ts's updateAvatar (ongoing multi-persona CRUD), so both
 * keep the builder's live preview and a real training session in sync with
 * whichever gender is currently selected, via one shared code path. See
 * lib/simli.ts's resolveSimliFaceId.
 */
export function withRecomputedSimliFaceId<T extends OnboardingDraftInput>(
  patch: T,
): T & { simliFaceId?: string | null } {
  if (patch.gender === undefined) return patch;
  return { ...patch, simliFaceId: resolveSimliFaceId(patch.gender as SimliGender) };
}

type CompletableAvatarFields = Pick<
  Avatar,
  "name" | "style" | "gender" | "skinTone" | "hairStyle" | "hairColor" | "outfit" | "expertise" | "voice"
>;

/**
 * Validates an avatar has every field onboarding.md's original 6 steps
 * require before it can go ACTIVE ("publish") — shared by
 * onboarding-service.ts's completeDraft (the one-time wizard's "complete")
 * and avatar-service.ts's publishAvatar (multi-persona CRUD's equivalent
 * action). Throws badRequest with a fields array naming what's missing,
 * same envelope shape both existing 400s already use.
 */
export function assertAvatarComplete(avatar: CompletableAvatarFields, errorCode: string): void {
  const result = onboardingCompleteRequiredSchema.safeParse({
    name: avatar.name ?? undefined,
    style: avatar.style ?? undefined,
    gender: avatar.gender ?? undefined,
    skinTone: avatar.skinTone ?? undefined,
    hairStyle: avatar.hairStyle ?? undefined,
    hairColor: avatar.hairColor ?? undefined,
    outfit: avatar.outfit ?? undefined,
    expertise: avatar.expertise ?? undefined,
    voice: avatar.voice ?? undefined,
  });

  if (!result.success) {
    const fields = result.error.issues.map((issue) => ({
      path: issue.path.join(".") || "unknown",
      message: issue.message,
    }));
    throw badRequest(errorCode, "avatar is missing required fields", fields);
  }
}
