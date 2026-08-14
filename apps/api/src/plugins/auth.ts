import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sha256Hex, withAuthContext, withOrg, type Role } from "@avatrain/shared";
import { getSessionToken } from "../lib/cookies.js";
import { forbidden, unauthorized } from "../lib/http-errors.js";

export interface RequestAuthContext {
  userId: string;
  orgId: string;
  role: Role;
}

declare module "fastify" {
  interface FastifyRequest {
    authContext?: RequestAuthContext;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/**
 * Not registered via app.register (no plugin encapsulation needed — this is
 * called directly from buildApp()). Resolves the session cookie, then
 * re-reads role fresh from Membership on every request — never trusts a
 * role cached on the Session row. See .claude/specs/authentication.md.
 */
export function registerAuthPlugin(app: FastifyInstance): void {
  app.decorateRequest("authContext", undefined);

  app.decorate("authenticate", async function authenticate(request: FastifyRequest) {
    const token = getSessionToken(request);
    if (!token) throw unauthorized("invalid_credentials");

    const tokenHash = sha256Hex(token);
    const session = await withAuthContext({ sessionLookupHash: tokenHash }, (tx) =>
      tx.session.findFirst({ where: { tokenHash } }),
    );
    if (!session || session.expiresAt < new Date()) {
      throw unauthorized("invalid_credentials");
    }

    const membership = await withOrg(session.orgId, (tx) =>
      tx.membership.findUnique({
        where: { orgId_userId: { orgId: session.orgId, userId: session.userId } },
      }),
    );
    if (!membership) throw unauthorized("invalid_credentials");

    request.authContext = { userId: session.userId, orgId: session.orgId, role: membership.role };
  });
}

export function requireRole(role: Role) {
  return async function requireRoleHandler(request: FastifyRequest): Promise<void> {
    if (request.authContext?.role !== role) {
      throw forbidden("forbidden");
    }
  };
}

/**
 * Sibling to requireRole, not a replacement — every existing single-role
 * callsite keeps using requireRole unchanged. Added for PARTNER
 * (.claude/specs/partner-role.md), which shares some routes with OWNER but
 * never all of them; per-role visibility narrowing beyond "is one of these
 * roles" happens in the route handler / service layer, not here.
 */
export function requireAnyRole(roles: Role[]) {
  return async function requireAnyRoleHandler(request: FastifyRequest): Promise<void> {
    if (!request.authContext || !roles.includes(request.authContext.role)) {
      throw forbidden("forbidden");
    }
  };
}
