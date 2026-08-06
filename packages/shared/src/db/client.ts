import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Runtime queries connect as a non-superuser, non-owner role so RLS policies
// are actually enforced — Postgres superusers and table owners bypass RLS
// unconditionally regardless of any CREATE POLICY. Migrations still run as
// the owner (DATABASE_URL) via `prisma migrate`. See
// prisma/migrations/*_app_role_rls and .claude/rules/tenancy.md.
//
// No fallback to DATABASE_URL: that's the superuser/owner connection, and
// silently degrading to it would mean RLS stops being enforced with no
// indication anything is wrong (security-reviewer flagged exactly this
// class of silent bypass). Fail loudly instead.
const runtimeUrl = process.env.APP_DATABASE_URL;
if (!runtimeUrl) {
  throw new Error(
    "APP_DATABASE_URL is not set. This must be the unprivileged avatrain_app role's " +
      "connection string (see prisma/migrations/20260806042200_app_role_rls), not " +
      "DATABASE_URL's superuser/owner — otherwise Row-Level Security silently does not " +
      "apply. Add APP_DATABASE_URL to your .env, e.g. " +
      "postgresql://avatrain_app:avatrain_app@localhost:5433/avatrain for local dev.",
  );
}

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ datasources: { db: { url: runtimeUrl } } });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
