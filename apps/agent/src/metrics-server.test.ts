import { afterEach, describe, expect, it, vi } from "vitest";
import { createMetricsServer, type MetricsServer } from "./metrics-server.js";

let server: MetricsServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

function fetchMetrics(port: number): Promise<{ status: number; body: string }> {
  return fetch(`http://127.0.0.1:${port}/metrics`).then(async (res) => ({
    status: res.status,
    body: await res.text(),
  }));
}

describe("createMetricsServer", () => {
  it("reports sessions_concurrent and worker_capacity as Prometheus gauges", async () => {
    server = createMetricsServer({ port: 9191, workerCapacity: 4, counter: { count: async () => 3 } });

    const { status, body } = await fetchMetrics(9191);

    expect(status).toBe(200);
    expect(body).toContain("avatrain_sessions_concurrent 3");
    expect(body).toContain("avatrain_worker_capacity 4");
  });

  it("returns 503 rather than a false zero when the counter fails to read", async () => {
    server = createMetricsServer({
      port: 9192,
      workerCapacity: 4,
      counter: { count: vi.fn().mockRejectedValue(new Error("redis down")) },
    });

    const { status } = await fetchMetrics(9192);

    expect(status).toBe(503);
  });

  it("404s any path other than /metrics", async () => {
    server = createMetricsServer({ port: 9193, workerCapacity: 4, counter: { count: async () => 0 } });

    const response = await fetch(`http://127.0.0.1:9193/other`);

    expect(response.status).toBe(404);
  });
});
