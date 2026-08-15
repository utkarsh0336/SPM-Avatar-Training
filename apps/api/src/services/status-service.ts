import {
  prisma,
  Sentry,
  type CreateIncidentRequest,
  type UpdateIncidentRequest,
  type UptimeCheckReport,
} from "@avatrain/shared";
import type { StatusIncident, UptimeCheck } from "@prisma/client";
import { notFound } from "../lib/http-errors.js";

export interface UptimeCheckSummary {
  service: string;
  region: string;
  status: string;
  latencyMs: number | null;
  checkedAt: string;
}

export interface StatusIncidentResult {
  id: string;
  title: string;
  severity: string;
  status: string;
  affectedRegions: string[];
  body: string;
  startedAt: string;
  resolvedAt: string | null;
}

export interface StatusSummary {
  services: UptimeCheckSummary[];
  incidents: StatusIncidentResult[];
}

function toUptimeCheckSummary(check: UptimeCheck): UptimeCheckSummary {
  return {
    service: check.service,
    region: check.region,
    status: check.status,
    latencyMs: check.latencyMs,
    checkedAt: check.checkedAt.toISOString(),
  };
}

function toStatusIncidentResult(incident: StatusIncident): StatusIncidentResult {
  return {
    id: incident.id,
    title: incident.title,
    severity: incident.severity,
    status: incident.status,
    affectedRegions: incident.affectedRegions,
    body: incident.body,
    startedAt: incident.startedAt.toISOString(),
    resolvedAt: incident.resolvedAt ? incident.resolvedAt.toISOString() : null,
  };
}

const RECENT_INCIDENT_LIMIT = 20;

/**
 * Backs GET /v1/status and GET /status (apps/api/src/routes/status.ts,
 * cached there with a short TTL — this function itself does no caching).
 * uptime_checks and status_incidents are global/RLS-exempt (see their
 * prisma/schema.prisma doc-comments) — plain prisma.* calls, no withOrg
 * wrapper, same as every existing prisma.user.* call in auth-service.ts.
 */
export async function getStatusSummary(): Promise<StatusSummary> {
  const [checks, incidents] = await Promise.all([
    // distinct + matching orderBy is Postgres DISTINCT ON semantics under
    // Prisma — "the latest row per (service, region)", not an arbitrary one.
    prisma.uptimeCheck.findMany({
      distinct: ["service", "region"],
      orderBy: [{ service: "asc" }, { region: "asc" }, { checkedAt: "desc" }],
    }),
    prisma.statusIncident.findMany({
      orderBy: { startedAt: "desc" },
      take: RECENT_INCIDENT_LIMIT,
    }),
  ]);

  return {
    services: checks.map(toUptimeCheckSummary),
    incidents: incidents.map(toStatusIncidentResult),
  };
}

/**
 * The synthetic-check GitHub Actions workflow (scripts/report-uptime-check.mjs)
 * calls POST /v1/internal/uptime-checks for every check, UP or DOWN — this
 * is the one place that decides a DOWN result is alert-worthy, so the
 * workflow script itself stays a plain-fetch reporter with no Sentry
 * dependency (scripts/*.mjs never import third-party packages in this
 * repo — see scripts/verify-provider-boundary.mjs). Sentry.captureMessage
 * is a no-op when SENTRY_DSN is unset (packages/shared/src/observability/
 * sentry.ts), same as every other Sentry call site.
 */
export async function recordUptimeCheck(input: UptimeCheckReport): Promise<void> {
  await prisma.uptimeCheck.create({ data: input });
  if (input.status === "DOWN") {
    Sentry.captureMessage(`Uptime check failed: ${input.service} (${input.region})`, "error");
  }
}

export async function createIncident(input: CreateIncidentRequest): Promise<StatusIncidentResult> {
  const incident = await prisma.statusIncident.create({ data: input });
  return toStatusIncidentResult(incident);
}

export async function updateIncident(incidentId: string, input: UpdateIncidentRequest): Promise<StatusIncidentResult> {
  const existing = await prisma.statusIncident.findUnique({ where: { id: incidentId } });
  if (!existing) throw notFound("incident_not_found");

  const incident = await prisma.statusIncident.update({
    where: { id: incidentId },
    data: input,
  });
  return toStatusIncidentResult(incident);
}
