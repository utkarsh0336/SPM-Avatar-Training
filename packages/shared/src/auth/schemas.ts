import { z } from "zod";

/**
 * Lowercasing happens here — the one funnel point every auth read/write path
 * goes through, per .claude/specs/authentication.md ("no citext extension").
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email();

export const passwordSchema = z.string().min(8).max(200);

export const orgNameSchema = z.string().trim().min(1).max(200);

export const signupSchema = z.object({
  orgName: orgNameSchema,
  email: emailSchema,
  password: passwordSchema,
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

// Capped at MEMBER/PARTNER — never OWNER, preserving the existing invariant
// that org ownership is only ever created by signup/Google self-serve, never
// granted via invite. See .claude/specs/partner-role.md.
export const inviteRoleSchema = z.enum(["MEMBER", "PARTNER"]);
export type InviteRole = z.infer<typeof inviteRoleSchema>;

export const inviteSchema = z.object({
  email: emailSchema,
  role: inviteRoleSchema.default("MEMBER"),
});
export type InviteInput = z.infer<typeof inviteSchema>;

export const acceptInviteSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

export const googleCallbackSchema = z.object({
  code: z.string().min(1),
  codeVerifier: z.string().min(1),
});
export type GoogleCallbackInput = z.infer<typeof googleCallbackSchema>;

export const roleSchema = z.enum(["OWNER", "MEMBER", "PARTNER"]);

// Admin-portal chrome language — see .claude/specs/dashboard-localization.md.
// Deliberately separate from the avatar's conversation-language schema
// (packages/shared/src/tutor/avatar-config.ts's languageSchema): that one
// drives the learner-facing avatar, this one drives the trainer/admin's own
// UI, and the two are allowed to diverge for a single user.
export const uiLocaleSchema = z.enum(["EN", "HI"]);
export type UiLocaleInput = z.infer<typeof uiLocaleSchema>;

// PATCH /v1/auth/me body — self-service, no other fields yet. The route
// derives the target user from the session (request.authContext.userId),
// never from the body, so there is no id field to validate here.
export const uiLocaleUpdateSchema = z.object({
  uiLocale: uiLocaleSchema,
});
export type UiLocaleUpdateInput = z.infer<typeof uiLocaleUpdateSchema>;

export const userResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  onboardingCompletedAt: z.string().nullable(),
  uiLocale: uiLocaleSchema,
});

export const orgResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});

export const authResponseSchema = z.object({
  user: userResponseSchema,
  org: orgResponseSchema,
  role: roleSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

export const memberSchema = z.object({
  userId: z.string().uuid(),
  email: z.string(),
  role: roleSchema,
  joinedAt: z.string(),
});

export const membersResponseSchema = z.object({
  members: z.array(memberSchema),
});
