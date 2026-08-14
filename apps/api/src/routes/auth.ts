import type { FastifyInstance } from "fastify";
import {
  acceptInviteSchema,
  exchangeGoogleCode,
  googleCallbackSchema,
  inviteSchema,
  loginSchema,
  signupSchema,
  uiLocaleUpdateSchema,
} from "@avatrain/shared";
import { requireRole } from "../plugins/auth.js";
import { clearSessionCookieHeader, getSessionToken, serializeSessionCookie } from "../lib/cookies.js";
import { checkRateLimit } from "../lib/rate-limit.js";
import { unauthorized } from "../lib/http-errors.js";
import * as authService from "../services/auth-service.js";

const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post("/v1/auth/signup", async (request, reply) => {
    // request.ip is only meaningful per-client if Fastify's `trustProxy` is
    // configured for the real deploy topology once one exists — behind an
    // unconfigured reverse proxy/LB, every request shares one IP and this
    // becomes a single global bucket for all tenants' signups combined.
    // Not fixed here since no deploy topology is decided yet (this repo
    // has no deploy config to configure trustProxy's proxy count/CIDR
    // against) — revisit when one lands.
    const key = `signup:${request.ip}`;
    if (!checkRateLimit(key, { max: 10, windowMs: 60_000 })) {
      throw unauthorized("rate_limited");
    }
    const input = signupSchema.parse(request.body);
    const result = await authService.signup(input);
    reply.header("set-cookie", serializeSessionCookie(result.token, SESSION_MAX_AGE_SECONDS));
    reply.status(201).send({ user: result.user, org: result.org, role: result.role });
  });

  app.post("/v1/auth/login", async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const key = `login:${input.email}:${request.ip}`;
    if (!checkRateLimit(key, { max: 10, windowMs: 60_000 })) {
      throw unauthorized("rate_limited");
    }
    const result = await authService.login(input);
    reply.header("set-cookie", serializeSessionCookie(result.token, SESSION_MAX_AGE_SECONDS));
    reply.status(200).send({ user: result.user, org: result.org, role: result.role });
  });

  app.post("/v1/auth/google/callback", async (request, reply) => {
    // Same request.ip caveat as /v1/auth/signup above — this call always
    // comes from apps/dashboard's server (see
    // apps/dashboard/app/api/auth/google/callback/route.ts), so without
    // trustProxy configured this is one global bucket, not a per-caller one.
    const key = `google_callback:${request.ip}`;
    if (!checkRateLimit(key, { max: 10, windowMs: 60_000 })) {
      throw unauthorized("rate_limited");
    }
    const input = googleCallbackSchema.parse(request.body);

    let profile;
    try {
      profile = await exchangeGoogleCode(input.code, input.codeVerifier);
    } catch (err) {
      // Never let the generic error handler's console.error(error) see this
      // one — a failed exchange throws a GaxiosError carrying the outgoing
      // request (authorization code, PKCE verifier, and potentially
      // client_secret) in its .config, and gaxios's redaction of secrets
      // from that object is documented as experimental, not guaranteed.
      console.error(
        "Google auth failed:",
        err instanceof Error ? err.message : err
  );
      throw unauthorized("google_auth_failed");
    }

    const result = await authService.loginWithGoogle(profile);
    reply.header("set-cookie", serializeSessionCookie(result.token, SESSION_MAX_AGE_SECONDS));
    reply.status(200).send({ user: result.user, org: result.org, role: result.role });
  });

  app.post("/v1/auth/logout", async (request, reply) => {
    const token = getSessionToken(request);
    await authService.logout(token);
    reply.header("set-cookie", clearSessionCookieHeader());
    reply.status(200).send({ ok: true });
  });

  app.get("/v1/auth/me", { preHandler: app.authenticate }, async (request, reply) => {
    // authenticate always populates authContext or throws first.
    const result = await authService.me(request.authContext!);
    reply.status(200).send(result);
  });

  // Self-service admin-portal chrome preference — no role gate, unlike
  // PATCH /v1/org/branding. See .claude/specs/dashboard-localization.md.
  app.patch("/v1/auth/me", { preHandler: app.authenticate }, async (request, reply) => {
    const input = uiLocaleUpdateSchema.parse(request.body);
    const result = await authService.updateMyLocale(request.authContext!, input);
    reply.status(200).send(result);
  });

  app.post(
    "/v1/auth/invite",
    { preHandler: [app.authenticate, requireRole("OWNER")] },
    async (request, reply) => {
      const input = inviteSchema.parse(request.body);
      const result = await authService.invite(request.authContext!.orgId, input);
      reply.status(201).send(result);
    },
  );

  app.post("/v1/auth/accept-invite", async (request, reply) => {
    const input = acceptInviteSchema.parse(request.body);
    const result = await authService.acceptInvite(input);
    reply.header("set-cookie", serializeSessionCookie(result.token, SESSION_MAX_AGE_SECONDS));
    reply.status(200).send({ user: result.user, org: result.org, role: result.role });
  });

  app.get(
    "/v1/auth/members",
    { preHandler: [app.authenticate, requireRole("OWNER")] },
    async (request, reply) => {
      const result = await authService.listMembers(request.authContext!.orgId);
      reply.status(200).send(result);
    },
  );
}
