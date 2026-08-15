import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { checkRateLimit } from "@avatrain/shared";
import type { EmbedConfigResponse } from "@avatrain/shared/contracts";
import { serviceUnavailable, forbidden } from "../lib/http-errors.js";
import { mintWsTicket } from "../lib/ws-tickets.js";
import * as applicationService from "../services/application-service.js";
import * as avatarService from "../services/avatar-service.js";

const keyQuerySchema = z.object({ key: z.string().min(1) });

// 20 tickets / 5 minutes per publishable key — deliberately tighter than
// the authenticated /v1/conversations/ticket route's default (no per-user
// identity backs this request, only a key any visitor to the embedding
// page can read out of that page's own JS).
const TICKET_RATE_LIMIT = { max: 20, windowMs: 5 * 60_000 };

/**
 * The public, unauthenticated surface a third-party embed actually talks
 * to — deliberately a separate file from routes/applications.ts (the
 * OWNER-only, cookie-authenticated CRUD for the same Application rows).
 * Fundamentally different trust model: no app.authenticate anywhere here.
 *
 * Both routes take `key` as a query param (not a JSON body) specifically
 * so neither request needs a Content-Type header — that keeps both a
 * "simple" CORS request per the Fetch spec, so no OPTIONS preflight
 * handler is needed here at all.
 *
 * Origin is checked server-side and rejected outright (403), not merely
 * omitted from the CORS response headers — CORS is a browser-only
 * protection; a non-browser caller (curl, a server) ignores it entirely, so
 * the real boundary has to be enforced here, not left to the browser. See
 * .claude/rules/embed.md's "origin-checked against an exact string... never '*'".
 */
export function registerEmbedRoutes(app: FastifyInstance): void {
  app.get("/v1/embed/config", async (request, reply) => {
    const { key } = keyQuerySchema.parse(request.query);
    const resolved = await resolveAndAuthorize(key, request.headers.origin, reply);
    if (!resolved) return;

    if (!resolved.avatarId) throw serviceUnavailable("embed_not_configured", "this embed has no avatar assigned yet");
    const avatar = await avatarService.getAvatarById(resolved.orgId, resolved.avatarId);
    if (!avatar || avatar.status !== "ACTIVE") {
      throw serviceUnavailable("embed_not_configured", "the pinned avatar is not published");
    }
    if (!avatar.style || !avatar.gender || !avatar.outfit || !avatar.expertise || !avatar.voice) {
      throw serviceUnavailable("embed_not_configured", "the pinned avatar is missing required fields");
    }

    const config: EmbedConfigResponse = {
      avatarId: avatar.id,
      avatarName: avatar.name ?? "AI Avatar",
      expertise: avatar.expertise,
      voiceTone: avatar.voice,
      style: avatar.style,
      gender: avatar.gender,
      outfit: avatar.outfit,
      skinTone: avatar.skinTone,
      hairStyle: avatar.hairStyle,
      hairColor: avatar.hairColor,
    };
    reply.status(200).send(config);
  });

  app.post("/v1/embed/ticket", async (request, reply) => {
    const { key } = keyQuerySchema.parse(request.query);
    const resolved = await resolveAndAuthorize(key, request.headers.origin, reply);
    if (!resolved) return;

    if (!resolved.avatarId) throw serviceUnavailable("embed_not_configured", "this embed has no avatar assigned yet");
    if (!(await checkRateLimit(`embed-ticket:${key}`, TICKET_RATE_LIMIT))) throw forbidden("rate_limited");

    const { ticket, expiresAt } = mintWsTicket({
      orgId: resolved.orgId,
      userId: null,
      pinnedAvatarId: resolved.avatarId,
    });
    reply.status(201).send({ ticket, expiresAt });
  });
}

/**
 * Shared resolve+authorize path for both routes: look up the Application by
 * key, 404 if unknown, 503 if disabled, 403 if the request's Origin isn't
 * on its allowlist — and only then set the CORS response headers, scoped
 * to that exact matched origin. Returns null (having already sent a reply)
 * on any failure, so callers can `if (!resolved) return;`.
 */
async function resolveAndAuthorize(
  key: string,
  origin: string | undefined,
  reply: FastifyReply,
): Promise<applicationService.ResolvedApplication | null> {
  const application = await applicationService.resolveApplicationByPublishableKey(key);
  if (!application) {
    reply.status(404).send({ error: "not_found" });
    return null;
  }
  if (!application.isEnabled) {
    reply.status(503).send({ error: "embed_disabled" });
    return null;
  }
  if (!origin || !application.allowedOrigins.includes(origin)) {
    reply.status(403).send({ error: "origin_not_allowed" });
    return null;
  }

  reply.header("Access-Control-Allow-Origin", origin);
  reply.header("Vary", "Origin");
  return application;
}
