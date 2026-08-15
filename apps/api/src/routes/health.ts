import type { FastifyInstance } from "fastify";
import { prisma, pingRedis } from "@avatrain/shared";

/**
 * Readiness probe, distinct from the existing bare /healthz liveness check
 * in app.ts. A pod can be alive (process running) but not yet able to serve
 * real traffic — an orchestrator's load balancer should hold traffic out
 * until this passes, not just until the process starts. Checks a real DB
 * round-trip and Redis connectivity, the two dependencies every request
 * path in this app needs.
 */
export function registerHealthRoutes(app: FastifyInstance): void {
  app.get("/readyz", async (_request, reply) => {
    try {
      await Promise.all([prisma.$queryRaw`SELECT 1`, pingRedis()]);
      return { status: "ready" };
    } catch (err) {
      reply.code(503);
      return { status: "not_ready", error: err instanceof Error ? err.message : String(err) };
    }
  });
}
