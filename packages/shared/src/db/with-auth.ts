import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "./client.js";

const uuidSchema = z.string().uuid();
// Raw SHA-256 hex digest (see auth/tokens.ts's sha256Hex) — not a UUID.
const sessionLookupHashSchema = z.string().regex(/^[0-9a-f]{64}$/);

export interface AuthContext {
  userId?: string;
  orgId?: string;
  sessionLookupHash?: string;
}

/**
 * Sibling to withOrg, not a replacement — every existing/future
 * business-data query keeps using withOrg exactly as today. This sets
 * whichever of app.current_user_id / app.current_org_id /
 * app.session_lookup_hash are provided, so RLS can be satisfied with partial
 * context (e.g. user known, org not yet resolved, mid-login). See
 * prisma/migrations/*_auth_rls and .claude/rules/tenancy.md.
 */
export async function setAuthContext(
  tx: Prisma.TransactionClient,
  ctx: AuthContext,
): Promise<void> {
  if (ctx.userId !== undefined) {
    const validUserId = uuidSchema.parse(ctx.userId);
    // SET LOCAL doesn't accept bind parameters — the zod parse above is the
    // injection guard, not string escaping (same reasoning as with-org.ts).
    await tx.$executeRawUnsafe(`SET LOCAL app.current_user_id = '${validUserId}'`);
  }
  if (ctx.orgId !== undefined) {
    const validOrgId = uuidSchema.parse(ctx.orgId);
    await tx.$executeRawUnsafe(`SET LOCAL app.current_org_id = '${validOrgId}'`);
  }
  if (ctx.sessionLookupHash !== undefined) {
    const validHash = sessionLookupHashSchema.parse(ctx.sessionLookupHash);
    await tx.$executeRawUnsafe(`SET LOCAL app.session_lookup_hash = '${validHash}'`);
  }
}

/**
 * Runs `fn` inside a transaction with the given auth context set for its
 * duration. For the simple case where all context is known upfront (/me,
 * the authenticate preHandler, GET /v1/auth/members). Flows that must
 * discover context mid-transaction (signup/login/acceptInvite inserting a
 * Membership/Session row) call setAuthContext directly inside their own
 * prisma.$transaction instead — see apps/api/src/services/auth-service.ts.
 */
export async function withAuthContext<T>(
  ctx: AuthContext,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await setAuthContext(tx, ctx);
    return fn(tx);
  });
}
