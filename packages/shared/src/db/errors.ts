import { Prisma } from "@prisma/client";

/** True for a unique-constraint violation (Prisma error code P2002) — the
 * race-condition case a preemptive findUnique check alone can't catch. */
export function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}
