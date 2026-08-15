import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@avatrain/shared";
import { buildApp } from "../app.js";

const createdCheckIds: string[] = [];
const createdIncidentIds: string[] = [];

async function cleanup(): Promise<void> {
  if (createdCheckIds.length > 0) {
    await prisma.uptimeCheck.deleteMany({ where: { id: { in: createdCheckIds } } });
  }
  if (createdIncidentIds.length > 0) {
    await prisma.statusIncident.deleteMany({ where: { id: { in: createdIncidentIds } } });
  }
}

afterAll(cleanup);

const app = buildApp();

describe("GET /v1/status", () => {
  it("reports the latest check per (service, region) and recent incidents", async () => {
    // Two checks for the same (service, region) — only the more recent one should surface.
    const older = await prisma.uptimeCheck.create({
      data: { region: "US", service: "status-test-api", status: "DOWN", checkedAt: new Date(Date.now() - 60_000) },
    });
    const newer = await prisma.uptimeCheck.create({
      data: { region: "US", service: "status-test-api", status: "UP", latencyMs: 120 },
    });
    createdCheckIds.push(older.id, newer.id);

    const incident = await prisma.statusIncident.create({
      data: {
        title: `Test incident ${randomUUID()}`,
        severity: "MINOR",
        affectedRegions: ["US"],
        body: "Investigating.",
      },
    });
    createdIncidentIds.push(incident.id);

    const response = await app.inject({ method: "GET", url: "/v1/status" });
    expect(response.statusCode).toBe(200);
    const body = response.json();

    const reported = body.services.find((s: { service: string }) => s.service === "status-test-api");
    expect(reported).toBeDefined();
    expect(reported.status).toBe("UP");
    expect(reported.latencyMs).toBe(120);

    const reportedIncident = body.incidents.find((i: { id: string }) => i.id === incident.id);
    expect(reportedIncident).toBeDefined();
    expect(reportedIncident.title).toBe(incident.title);
  });
});

describe("GET /status", () => {
  it("renders an HTML page", async () => {
    const response = await app.inject({ method: "GET", url: "/status" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("Avatrain Status");
  });
});
