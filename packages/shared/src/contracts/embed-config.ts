import { z } from "zod";
import {
  avatarStyleSchema,
  genderSchema,
  outfitSchema,
  expertiseSchema,
  voiceToneSchema,
  hairStyleSchema,
  skinToneSchema,
  hairColorSchema,
} from "../tutor/avatar-config.js";

/**
 * Zod-authoritative version of packages/embed/src/index.ts's hand-rolled
 * postMessage parser (parseInboundMessage) — that package ships zero
 * runtime dependencies (10KB gzip budget, .claude/rules/embed.md), so it
 * can't depend on zod itself. This is the source of truth for the wire
 * shape; packages/embed/src/index.test.ts asserts its hand-rolled version
 * accepts/rejects the exact same inputs as this schema. apps/widget uses
 * this schema directly (it has no such size budget) to construct/validate
 * its own side of the same postMessage channel.
 */
export const embedReadyMessageSchema = z.object({ type: z.literal("avatrain:ready") });
export type EmbedReadyMessage = z.infer<typeof embedReadyMessageSchema>;

export const embedResizeMessageSchema = z.object({
  type: z.literal("avatrain:resize"),
  height: z.number().positive(),
});
export type EmbedResizeMessage = z.infer<typeof embedResizeMessageSchema>;

/** Iframe (apps/widget) -> parent (packages/embed) messages. */
export const embedInboundMessageSchema = z.discriminatedUnion("type", [
  embedReadyMessageSchema,
  embedResizeMessageSchema,
]);
export type EmbedInboundMessage = z.infer<typeof embedInboundMessageSchema>;

/** Parent (packages/embed) -> iframe (apps/widget) messages. */
export const embedDestroyMessageSchema = z.object({ type: z.literal("avatrain:destroy") });
export type EmbedDestroyMessage = z.infer<typeof embedDestroyMessageSchema>;

/**
 * GET /v1/embed/config's response body — the persona fields apps/widget
 * needs to render the avatar and start a session, resolved server-side
 * from the Application's pinned avatarId (never client-suppliable). See
 * apps/api/src/routes/embed.ts.
 */
export const embedConfigResponseSchema = z.object({
  avatarId: z.string().uuid(),
  avatarName: z.string(),
  expertise: expertiseSchema,
  voiceTone: voiceToneSchema,
  style: avatarStyleSchema,
  gender: genderSchema,
  outfit: outfitSchema,
  skinTone: skinToneSchema.nullable(),
  hairStyle: hairStyleSchema.nullable(),
  hairColor: hairColorSchema.nullable(),
});
export type EmbedConfigResponse = z.infer<typeof embedConfigResponseSchema>;

export const embedTicketRequestSchema = z.object({ key: z.string().min(1) });
export type EmbedTicketRequest = z.infer<typeof embedTicketRequestSchema>;

export const embedTicketResponseSchema = z.object({
  ticket: z.string(),
  expiresAt: z.number(),
});
export type EmbedTicketResponse = z.infer<typeof embedTicketResponseSchema>;
