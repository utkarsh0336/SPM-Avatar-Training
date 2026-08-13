import { z } from "zod";

/**
 * Exact-string origin, e.g. "https://example.com" — no path, no trailing
 * slash, no wildcard. embed.ts's origin check is a Set.has() against this
 * exact value, per .claude/rules/embed.md ("origin-checked against an exact
 * string... Never '*'"). Deliberately stricter than a general URL: a path
 * or query string would silently never match a real Origin header (which
 * never carries one), so reject it here rather than let it fail silently at
 * request time.
 */
export const originSchema = z
  .string()
  .trim()
  .regex(/^https?:\/\/[^/\s]+$/, "must be an origin like https://example.com — no path, no trailing slash");

export const applicationIdParamSchema = z.object({ applicationId: z.string().uuid() });
export type ApplicationIdParam = z.infer<typeof applicationIdParamSchema>;

/**
 * OWNER-facing record — apps/dashboard's embed settings page. Includes the
 * publishableKey (safe to display/copy; it's public by design, embedded in
 * every page that loads the widget) but nothing secret, since no secret
 * key exists for this model — see prisma/schema.prisma's Application doc
 * comment.
 */
export const applicationRecordSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  publishableKey: z.string(),
  allowedOrigins: z.array(originSchema),
  avatarId: z.string().uuid().nullable(),
  isEnabled: z.boolean(),
});
export type ApplicationRecord = z.infer<typeof applicationRecordSchema>;

export const listApplicationsResponseSchema = z.object({ applications: z.array(applicationRecordSchema) });
export type ListApplicationsResponse = z.infer<typeof listApplicationsResponseSchema>;

export const getApplicationResponseSchema = z.object({ application: applicationRecordSchema });
export type GetApplicationResponse = z.infer<typeof getApplicationResponseSchema>;

export const createApplicationRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
});
export type CreateApplicationRequest = z.infer<typeof createApplicationRequestSchema>;

export const updateApplicationRequestSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  allowedOrigins: z.array(originSchema).max(20).optional(),
  avatarId: z.string().uuid().nullable().optional(),
  isEnabled: z.boolean().optional(),
});
export type UpdateApplicationRequest = z.infer<typeof updateApplicationRequestSchema>;
