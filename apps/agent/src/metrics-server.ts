import { createServer, type Server } from "node:http";
import type { ConcurrencyCounter } from "@avatrain/shared";

/**
 * Exposes sessions_concurrent / worker_capacity as Prometheus gauges on
 * :METRICS_PORT/metrics — the exact port/path Fly.io's built-in scraper
 * expects (infra/fly's `[metrics]` block), which is what feeds
 * fly-autoscaler's created-machine-count/started-machine-count expressions
 * per docs/ARCHITECTURE.md §4 ("Scale on sessions_concurrent /
 * worker_capacity, not CPU").
 *
 * Every worker machine in the fleet reports the *same* global
 * sessions_concurrent value (it's a fleet-wide Redis counter, not a
 * per-machine one) — the autoscaler's PromQL query is expected to
 * `max()`/`avg()` across machines rather than `sum()`, or it will double
 * (or N-tuple) count. See infra/README.md.
 *
 * Not on any realtime hot path — this server only answers scrape requests,
 * on a separate port from anything LiveKit-facing, and never touches a
 * per-turn/per-frame code path.
 */
export interface MetricsServerOptions {
  port: number;
  workerCapacity: number;
  counter: Pick<ConcurrencyCounter, "count">;
}

export interface MetricsServer {
  close(): Promise<void>;
}

function renderMetrics(sessionsConcurrent: number, workerCapacity: number): string {
  return (
    `# HELP avatrain_sessions_concurrent Active Mode B sessions across the whole worker fleet.\n` +
    `# TYPE avatrain_sessions_concurrent gauge\n` +
    `avatrain_sessions_concurrent ${sessionsConcurrent}\n` +
    `# HELP avatrain_worker_capacity Max concurrent sessions this worker process can hold.\n` +
    `# TYPE avatrain_worker_capacity gauge\n` +
    `avatrain_worker_capacity ${workerCapacity}\n`
  );
}

export function createMetricsServer(options: MetricsServerOptions): MetricsServer {
  const server: Server = createServer((req, res) => {
    if (req.method !== "GET" || req.url !== "/metrics") {
      res.writeHead(404).end();
      return;
    }
    options.counter
      .count()
      .then((sessionsConcurrent) => {
        res.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
        res.end(renderMetrics(sessionsConcurrent, options.workerCapacity));
      })
      .catch((err) => {
        // Fail closed, matching ConcurrencyCounter.count()'s own contract —
        // a failed scrape must never read as "zero load" to the autoscaler.
        console.error("[metrics-server] count() failed:", err);
        res.writeHead(503).end();
      });
  });
  // 0.0.0.0, not localhost — Fly's scraper connects from outside this
  // container's loopback interface (see fly.io/docs/monitoring/metrics).
  server.listen(options.port, "0.0.0.0");

  return {
    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
