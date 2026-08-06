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

export const inviteSchema = z.object({
  email: emailSchema,
});
export type InviteInput = z.infer<typeof inviteSchema>;

export const acceptInviteSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

export const roleSchema = z.enum(["OWNER", "MEMBER"]);

export const userResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
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
