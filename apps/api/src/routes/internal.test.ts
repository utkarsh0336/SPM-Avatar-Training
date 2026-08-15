import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@avatrain/shared";
import { buildApp } from "../app.js";

const TOKEN = "a".repeat(32);

const createdCheckServices: string[] = [];
const createdIncidentIds: string[] = [];

async function cleanup(): Promise<void> {
  if (createdCheckServices.length > 0) {
    await prisma.uptimeCheck.deleteMany({ where: { service: { in: createdCheckServices } } });
  }
  if (createdIncidentIds.length > 0) {
    await prisma.statusIncident.deleteMany({ where: { id: { in: createdIncidentIds } } });
  }
}

afterEach(() => vi.unstubAllEnvs());
afterAll(cleanup);

const app = buildApp();

describe("internal ops auth gate", () => {
  it("returns 503 when INTERNAL_OPS_TOKEN is not configured", async () => {
    vi.stubEnv("INTERNAL_OPS_TOKEN", undefined);
    const response = await app.inject({
      method: "POST",
      url: "/v1/internal/uptime-checks",
      payload: { region: "US", service: "internal-test", status: "UP" },
    });
    expect(response.statusCode).toBe(503);
  });

  it("returns 401 with a missing or wrong bearer token", async () => {
    vi.stubEnv("INTERNAL_OPS_TOKEN", TOKEN);
    const response = await app.inject({
      method: "POST",
      url: "/v1/internal/uptime-checks",
      headers: { authorization: "Bearer wrong-token" },
      payload: { region: "US", service: "internal-test", status: "UP" },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe("POST /v1/internal/uptime-checks", () => {
  it("records a check with a valid token", async () => {
    vi.stubEnv("INTERNAL_OPS_TOKEN", TOKEN);
    createdCheckServices.push("internal-test");

    const response = await app.inject({
      method: "POST",
      url: "/v1/internal/uptime-checks",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { region: "US", service: "internal-test", status: "UP", latencyMs: 50 },
    });
    expect(response.statusCode).toBe(201);

    const row = await prisma.uptimeCheck.findFirst({ where: { service: "internal-test" } });
    expect(row?.status).toBe("UP");
  });
});

describe("POST /v1/internal/incidents + PATCH /v1/internal/incidents/:id", () => {
  it("creates then updates an incident with a valid token", async () => {
    vi.stubEnv("INTERNAL_OPS_TOKEN", TOKEN);

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/internal/incidents",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: {
        title: "internal-test incident",
        severity: "MINOR",
        affectedRegions: ["US"],
        body: "Investigating.",
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const { incident } = createResponse.json();
    createdIncidentIds.push(incident.id);
    expect(incident.status).toBe("INVESTIGATING");

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/v1/internal/incidents/${incident.id}`,
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { status: "RESOLVED" },
    });
    expect(patchResponse.statusCode).toBe(200);
    expect(patchResponse.json().incident.status).toBe("RESOLVED");
  });

  it("returns 404 when updating an incident that doesn't exist", async () => {
    vi.stubEnv("INTERNAL_OPS_TOKEN", TOKEN);
    const response = await app.inject({
      method: "PATCH",
      url: "/v1/internal/incidents/00000000-0000-0000-0000-000000000000",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { status: "RESOLVED" },
    });
    expect(response.statusCode).toBe(404);
  });
});
