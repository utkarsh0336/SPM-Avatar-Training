import { generateOpaqueToken, withAuthContext, withOrg, type ApplicationRecord, type UpdateApplicationRequest } from "@avatrain/shared";
import type { Application } from "@prisma/client";
import { notFound } from "../lib/http-errors.js";

function toApplicationRecord(application: Application): ApplicationRecord {
  return {
    id: application.id,
    name: application.name,
    publishableKey: application.publishableKey,
    allowedOrigins: application.allowedOrigins,
    avatarId: application.avatarId,
    isEnabled: application.isEnabled,
  };
}

/** GET /v1/applications — OWNER only. */
export async function listApplications(orgId: string): Promise<ApplicationRecord[]> {
  return withOrg(orgId, async (tx) => {
    const applications = await tx.application.findMany({ where: { orgId }, orderBy: { createdAt: "desc" } });
    return applications.map(toApplicationRecord);
  });
}

/**
 * POST /v1/applications — OWNER only. Mints a fresh publishableKey — this
 * value is public by design (embedded in every page that loads the widget)
 * so it's stored in plaintext, unlike a session token's sha256Hex.
 */
export async function createApplication(orgId: string, name: string): Promise<ApplicationRecord> {
  const publishableKey = `pk_${generateOpaqueToken()}`;
  return withOrg(orgId, async (tx) => {
    const application = await tx.application.create({ data: { orgId, name, publishableKey } });
    return toApplicationRecord(application);
  });
}

/** PATCH /v1/applications/:applicationId — OWNER only. Partial update. */
export async function updateApplication(
  orgId: string,
  applicationId: string,
  patch: UpdateApplicationRequest,
): Promise<ApplicationRecord> {
  return withOrg(orgId, async (tx) => {
    const existing = await tx.application.findFirst({ where: { orgId, id: applicationId } });
    if (!existing) throw notFound("application_not_found");
    const updated = await tx.application.update({ where: { id: applicationId }, data: patch });
    return toApplicationRecord(updated);
  });
}

/** DELETE /v1/applications/:applicationId — OWNER only. A hard delete is safe here (unlike Avatar) — no other table has a required FK onto Application. */
export async function deleteApplication(orgId: string, applicationId: string): Promise<void> {
  await withOrg(orgId, async (tx) => {
    const existing = await tx.application.findFirst({ where: { orgId, id: applicationId } });
    if (!existing) throw notFound("application_not_found");
    await tx.application.delete({ where: { id: applicationId } });
  });
}

export interface ResolvedApplication {
  id: string;
  orgId: string;
  allowedOrigins: string[];
  avatarId: string | null;
  isEnabled: boolean;
}

/**
 * Resolves an Application purely by its publishableKey — the entry point
 * for every public embed request (routes/embed.ts), where the caller's
 * orgId isn't known yet (finding this row IS what reveals it). Uses
 * withAuthContext's publishableKeyLookup, not withOrg — see
 * packages/shared/src/db/with-auth.ts and the
 * application_publishable_key_rls migration. Returns null for an unknown
 * key; embed.ts is responsible for turning that into a 404/503, not this
 * function throwing.
 */
export async function resolveApplicationByPublishableKey(publishableKey: string): Promise<ResolvedApplication | null> {
  return withAuthContext({ publishableKeyLookup: publishableKey }, async (tx) => {
    const application = await tx.application.findFirst({ where: { publishableKey } });
    if (!application) return null;
    return {
      id: application.id,
      orgId: application.orgId,
      allowedOrigins: application.allowedOrigins,
      avatarId: application.avatarId,
      isEnabled: application.isEnabled,
    };
  });
}
