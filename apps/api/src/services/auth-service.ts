import { randomUUID } from "node:crypto";
import {
  generateOpaqueToken,
  hashPassword,
  isUniqueConstraintError,
  prisma,
  setAuthContext,
  sha256Hex,
  verifyPassword,
  withAuthContext,
  withOrg,
  type AcceptInviteInput,
  type InviteInput,
  type LoginInput,
  type Role,
  type SignupInput,
} from "@avatrain/shared";
import { badRequest, conflict, gone, unauthorized } from "../lib/http-errors.js";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionResult {
  token: string;
  user: { id: string; email: string };
  org: { id: string; name: string };
  role: Role;
}

export interface MeResult {
  user: { id: string; email: string };
  org: { id: string; name: string };
  role: Role;
}

function newSessionExpiry(): Date {
  return new Date(Date.now() + SESSION_TTL_MS);
}

// A fixed hash to verify against when the email doesn't exist (or has no
// password yet), so an unknown-email login pays the same Argon2 cost as a
// wrong-password one — the response body is already identical per the spec,
// but skipping verifyPassword entirely would leak email existence via
// response timing instead. Computed once, lazily, not per request.
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword("timing-safety-dummy-password-never-used-as-real-credential");
  return dummyHash;
}

export async function signup(input: SignupInput): Promise<SessionResult> {
  const orgId = randomUUID();
  const userId = randomUUID();
  const token = generateOpaqueToken();
  const tokenHash = sha256Hex(token);
  const passwordHash = await hashPassword(input.password);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.organization.create({ data: { id: orgId, name: input.orgName } });
      await tx.user.create({ data: { id: userId, email: input.email, passwordHash } });
      // Both are now known — set context before the RLS-scoped inserts.
      await setAuthContext(tx, { userId, orgId });
      await tx.membership.create({ data: { orgId, userId, role: "OWNER" } });
      await tx.session.create({
        data: { orgId, userId, tokenHash, expiresAt: newSessionExpiry() },
      });
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) throw conflict("email_taken");
    throw err;
  }

  return {
    token,
    user: { id: userId, email: input.email },
    org: { id: orgId, name: input.orgName },
    role: "OWNER",
  };
}

export async function login(input: LoginInput): Promise<SessionResult> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  // Always pay the Argon2 cost, even for an unknown email or a pending
  // invite with no password set yet — otherwise the 401 is instant for
  // those cases and slow for a genuine wrong password, leaking which case
  // occurred via timing even though the response body is identical.
  const hashToCheck = user?.passwordHash ?? (await getDummyHash());
  const passwordOk = await verifyPassword(input.password, hashToCheck);
  if (!user || !user.passwordHash || !passwordOk) throw unauthorized("invalid_credentials");

  // Org isn't known yet — bootstrap with just user_id (the reason the
  // memberships/sessions RLS policies tolerate partial context).
  const membership = await withAuthContext({ userId: user.id }, (tx) =>
    tx.membership.findFirst({ where: { userId: user.id } }),
  );
  if (!membership) throw unauthorized("invalid_credentials");

  const token = generateOpaqueToken();
  const tokenHash = sha256Hex(token);
  const org = await prisma.$transaction(async (tx) => {
    await setAuthContext(tx, { userId: user.id, orgId: membership.orgId });
    await tx.session.create({
      data: {
        orgId: membership.orgId,
        userId: user.id,
        tokenHash,
        expiresAt: newSessionExpiry(),
      },
    });
    return tx.organization.findUniqueOrThrow({ where: { id: membership.orgId } });
  });

  return {
    token,
    user: { id: user.id, email: user.email },
    org: { id: org.id, name: org.name },
    role: membership.role,
  };
}

export async function logout(token: string | undefined): Promise<void> {
  if (!token) return;
  const tokenHash = sha256Hex(token);
  await withAuthContext({ sessionLookupHash: tokenHash }, (tx) =>
    tx.session.deleteMany({ where: { tokenHash } }),
  );
}

export async function me(authContext: {
  userId: string;
  orgId: string;
  role: Role;
}): Promise<MeResult> {
  const [user, org] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: authContext.userId } }),
    prisma.organization.findUniqueOrThrow({ where: { id: authContext.orgId } }),
  ]);
  return {
    user: { id: user.id, email: user.email },
    org: { id: org.id, name: org.name },
    role: authContext.role,
  };
}

export async function invite(
  orgId: string,
  input: InviteInput,
): Promise<{ inviteUrl: string }> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw conflict("email_taken");

  const userId = randomUUID();
  const token = generateOpaqueToken();
  const tokenHash = sha256Hex(token);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.create({
        data: {
          id: userId,
          email: input.email,
          status: "PENDING",
          inviteTokenHash: tokenHash,
          inviteTokenExpiresAt: new Date(Date.now() + INVITE_TTL_MS),
        },
      });
      // One transaction, not two — a crash between separate transactions
      // would leave an orphaned PENDING user with no membership and a
      // permanently unusable invite token (acceptInvite requires one).
      await setAuthContext(tx, { orgId });
      await tx.membership.create({ data: { orgId, userId, role: "MEMBER" } });
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) throw conflict("email_taken");
    throw err;
  }

  return { inviteUrl: `/accept-invite?token=${token}` };
}

export async function acceptInvite(input: AcceptInviteInput): Promise<SessionResult> {
  const inviteTokenHash = sha256Hex(input.token);
  const user = await prisma.user.findUnique({ where: { inviteTokenHash } });
  if (!user) throw badRequest("invalid_token");
  if (!user.inviteTokenExpiresAt || user.inviteTokenExpiresAt < new Date()) {
    throw gone("invite_expired");
  }

  const membership = await withAuthContext({ userId: user.id }, (tx) =>
    tx.membership.findFirst({ where: { userId: user.id } }),
  );
  if (!membership) throw badRequest("invalid_token");

  const passwordHash = await hashPassword(input.password);
  const token = generateOpaqueToken();
  const tokenHash = sha256Hex(token);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        status: "ACTIVE",
        inviteTokenHash: null,
        inviteTokenExpiresAt: null,
      },
    });
    await setAuthContext(tx, { userId: user.id, orgId: membership.orgId });
    await tx.session.create({
      data: {
        orgId: membership.orgId,
        userId: user.id,
        tokenHash,
        expiresAt: newSessionExpiry(),
      },
    });
  });

  const org = await prisma.organization.findUniqueOrThrow({ where: { id: membership.orgId } });

  return {
    token,
    user: { id: user.id, email: user.email },
    org: { id: org.id, name: org.name },
    role: membership.role,
  };
}

export interface MemberResult {
  userId: string;
  email: string;
  role: Role;
  joinedAt: string;
}

export async function listMembers(orgId: string): Promise<{ members: MemberResult[] }> {
  const memberships = await withOrg(orgId, (tx) =>
    tx.membership.findMany({
      where: { orgId },
      include: { user: { select: { email: true } } },
      orderBy: { createdAt: "asc" },
    }),
  );

  return {
    members: memberships.map((m) => ({
      userId: m.userId,
      email: m.user.email,
      role: m.role,
      joinedAt: m.createdAt.toISOString(),
    })),
  };
}
