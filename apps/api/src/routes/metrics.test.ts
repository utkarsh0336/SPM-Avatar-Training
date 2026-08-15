import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

describe("GET /metrics", () => {
  it("returns Prometheus text format with the up gauge and error counter", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/metrics" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.body).toContain("avatrain_api_up 1");
    expect(response.body).toMatch(/avatrain_api_error_count_total \d+/);
  });
});
