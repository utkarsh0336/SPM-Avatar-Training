import type { FastifyInstance } from "fastify";
import { getApiErrorCount } from "../lib/http-errors.js";

// Hand-rolled Prometheus text format, same convention as
// apps/agent/src/metrics-server.ts (no prom-client dependency anywhere in
// this repo — see .claude/specs/reliability-uptime-disaster-recovery.md's
// "no new dependency for metrics" decision). Served as a Fastify route on
// the app's existing HTTP surface rather than a second http.createServer —
// unlike apps/agent's worker process, apps/api already has one port.
function renderMetrics(): string {
  return (
    `# HELP avatrain_api_up Always 1 when this handler runs — Fly's scraper reaching this route is itself a liveness signal.\n` +
    `# TYPE avatrain_api_up gauge\n` +
    `avatrain_api_up 1\n` +
    `# HELP avatrain_api_error_count_total Count of 5xx responses since process start (see apps/api/src/lib/http-errors.ts).\n` +
    `# TYPE avatrain_api_error_count_total counter\n` +
    `avatrain_api_error_count_total ${getApiErrorCount()}\n`
  );
}

export function registerMetricsRoutes(app: FastifyInstance): void {
  app.get("/metrics", async (_request, reply) => {
    reply.type("text/plain; version=0.0.4").send(renderMetrics());
  });
}
