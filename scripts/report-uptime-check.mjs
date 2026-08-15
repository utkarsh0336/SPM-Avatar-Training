#!/usr/bin/env node
// Run by .github/workflows/synthetic-uptime-check.yml. Deliberately zero
// third-party imports — see scripts/verify-provider-boundary.mjs's
// convention that no script in this directory pulls in an npm dependency.
//
// Only apps/api's two regions are checked here, not apps/agent's — agent-us/
// agent-eu (infra/fly/agent-*.toml) have no [http_service] block at all
// (LiveKit workers, not HTTP servers), so nothing public is reachable from
// a GitHub Actions runner outside Fly's private network. apps/agent's
// liveness is already covered by Fly's own internal Prometheus scrape of
// :9091/metrics (pre-existing, from feature/auto-scaling) feeding
// fly-autoscaler — this script does not duplicate that.
//
// Reports every result (UP or DOWN) to POST /v1/internal/uptime-checks —
// apps/api/src/services/status-service.ts's recordUptimeCheck() is what
// decides a DOWN result is Sentry-alert-worthy, not this script.

const TARGETS = [
  { region: "US", baseUrl: "https://avatrain-api-us.fly.dev" },
  { region: "EU", baseUrl: "https://avatrain-api-eu.fly.dev" },
];

const CHECK_TIMEOUT_MS = 5000;

const internalOpsToken = process.env.INTERNAL_OPS_TOKEN;
if (!internalOpsToken) {
  console.error("report-uptime-check: INTERNAL_OPS_TOKEN is not set — cannot report results.");
  process.exit(1);
}

// Report through whichever region's API is currently reachable — a
// same-region outage must not also block recording that outage.
const reportBaseUrls = [...TARGETS.map((t) => t.baseUrl)];

async function checkTarget(target) {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${target.baseUrl}/readyz`, { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
    const latencyMs = Date.now() - startedAt;
    return { region: target.region, service: "api", status: response.ok ? "UP" : "DOWN", latencyMs };
  } catch {
    return { region: target.region, service: "api", status: "DOWN" };
  }
}

async function report(result) {
  for (const baseUrl of reportBaseUrls) {
    try {
      const response = await fetch(`${baseUrl}/v1/internal/uptime-checks`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${internalOpsToken}` },
        body: JSON.stringify(result),
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
      if (response.ok) return true;
    } catch {
      // try the next base URL
    }
  }
  return false;
}

const results = await Promise.all(TARGETS.map(checkTarget));

let anyReportFailed = false;
for (const result of results) {
  console.log(`${result.service} (${result.region}): ${result.status}${result.latencyMs ? ` ${result.latencyMs}ms` : ""}`);
  const reported = await report(result);
  if (!reported) {
    anyReportFailed = true;
    console.error(`report-uptime-check: failed to report ${result.service} (${result.region}) to any region's API.`);
  }
}

const anyDown = results.some((r) => r.status === "DOWN");
// Non-zero exit when a check failed OR reporting itself failed — either
// case is worth a GitHub Actions job-failure notification as a last-resort
// signal, even when the primary Sentry alert path (recordUptimeCheck())
// couldn't be reached at all.
if (anyDown || anyReportFailed) process.exit(1);
