import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

describe("GET /readyz", () => {
  it("returns 200 and ready when the DB and Redis are both reachable", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/readyz" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ready" });
  });
});
