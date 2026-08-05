import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "./client.js";

const orgIdSchema = z.string().uuid();

/**
 * Runs `fn` inside a transaction with `app.current_org_id` set for its
 * duration, so every query `fn` issues is subject to the tenant's RLS
 * policies. Raw `prisma.$queryRaw` outside this wrapper is a defect, not a
 * shortcut — see .claude/rules/tenancy.md.
 */
export async function withOrg<T>(
  orgId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const validOrgId = orgIdSchema.parse(orgId);

  return prisma.$transaction(async (tx) => {
    // SET LOCAL doesn't accept bind parameters — the zod UUID parse above is
    // the injection guard, not string escaping.
    await tx.$executeRawUnsafe(`SET LOCAL app.current_org_id = '${validOrgId}'`);
    return fn(tx);
  });
}
