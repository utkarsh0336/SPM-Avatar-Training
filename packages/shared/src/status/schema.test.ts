import { describe, expect, it } from "vitest";
import {
  createIncidentRequestSchema,
  incidentIdRouteParamSchema,
  updateIncidentRequestSchema,
  uptimeCheckReportSchema,
} from "./schema.js";

describe("uptimeCheckReportSchema", () => {
  it("accepts a well-formed check result", () => {
    const result = uptimeCheckReportSchema.safeParse({ region: "US", service: "api", status: "UP", latencyMs: 42 });
    expect(result.success).toBe(true);
  });

  it("accepts an omitted latencyMs (e.g. a DOWN result with no successful response to time)", () => {
    const result = uptimeCheckReportSchema.safeParse({ region: "EU", service: "agent", status: "DOWN" });
    expect(result.success).toBe(true);
  });

  it("rejects an unrecognized region", () => {
    expect(uptimeCheckReportSchema.safeParse({ region: "APAC", service: "api", status: "UP" }).success).toBe(false);
  });
});

describe("createIncidentRequestSchema", () => {
  it("accepts a well-formed incident", () => {
    const result = createIncidentRequestSchema.safeParse({
      title: "Elevated latency in US region",
      severity: "MAJOR",
      affectedRegions: ["US"],
      body: "Investigating elevated p95 latency on apps/api-us.",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty affectedRegions array", () => {
    const result = createIncidentRequestSchema.safeParse({
      title: "x",
      severity: "MINOR",
      affectedRegions: [],
      body: "x",
    });
    expect(result.success).toBe(false);
  });
});

describe("updateIncidentRequestSchema", () => {
  it("accepts a partial update with only status set", () => {
    expect(updateIncidentRequestSchema.safeParse({ status: "RESOLVED" }).success).toBe(true);
  });

  it("accepts an empty object — every field is optional", () => {
    expect(updateIncidentRequestSchema.safeParse({}).success).toBe(true);
  });
});

describe("incidentIdRouteParamSchema", () => {
  it("rejects a non-uuid id", () => {
    expect(incidentIdRouteParamSchema.safeParse({ incidentId: "not-a-uuid" }).success).toBe(false);
  });
});
