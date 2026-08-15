import { z } from "zod";

const dataRegionSchema = z.enum(["US", "EU"]);

/** Body of POST /v1/internal/uptime-checks — one synthetic-check result per call. */
export const uptimeCheckReportSchema = z.object({
  region: dataRegionSchema,
  // Free string ("api" | "agent" today), matching UptimeCheck.service in
  // prisma/schema.prisma — a new deployable service shouldn't need a schema
  // change here to start reporting.
  service: z.string().trim().min(1).max(40),
  status: z.enum(["UP", "DOWN"]),
  latencyMs: z.number().int().nonnegative().optional(),
});
export type UptimeCheckReport = z.infer<typeof uptimeCheckReportSchema>;

/** Body of POST /v1/internal/incidents. */
export const createIncidentRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  severity: z.enum(["MINOR", "MAJOR", "CRITICAL"]),
  affectedRegions: z.array(dataRegionSchema).min(1),
  body: z.string().trim().min(1).max(5000),
});
export type CreateIncidentRequest = z.infer<typeof createIncidentRequestSchema>;

/** Body of PATCH /v1/internal/incidents/:incidentId. All fields optional — a partial update. */
export const updateIncidentRequestSchema = z.object({
  status: z.enum(["INVESTIGATING", "IDENTIFIED", "MONITORING", "RESOLVED"]).optional(),
  body: z.string().trim().min(1).max(5000).optional(),
  resolvedAt: z.coerce.date().optional(),
});
export type UpdateIncidentRequest = z.infer<typeof updateIncidentRequestSchema>;

export const incidentIdRouteParamSchema = z.object({ incidentId: z.string().uuid() });
export type IncidentIdRouteParam = z.infer<typeof incidentIdRouteParamSchema>;
