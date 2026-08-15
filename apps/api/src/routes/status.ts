import type { FastifyInstance } from "fastify";
import { getStatusSummary, type StatusSummary } from "../services/status-service.js";

// Short in-memory TTL cache, not a new caching dependency — GET /v1/status
// and GET /status are public/unauthenticated and must stay cheap enough to
// survive being hit repeatedly during a real incident (docs/ROADMAP.md
// Phase 8's SLO posture), without adding load to Postgres on every request.
const CACHE_TTL_MS = 15_000;
let cached: { data: StatusSummary; expiresAt: number } | null = null;

async function getCachedStatusSummary(): Promise<StatusSummary> {
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  const data = await getStatusSummary();
  cached = { data, expiresAt: Date.now() + CACHE_TTL_MS };
  return data;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderStatusHtml(summary: StatusSummary): string {
  const serviceRows = summary.services
    .map(
      (s) =>
        `<tr><td>${escapeHtml(s.service)}</td><td>${escapeHtml(s.region)}</td>` +
        `<td class="${s.status === "UP" ? "up" : "down"}">${escapeHtml(s.status)}</td>` +
        `<td>${s.latencyMs ?? "—"}</td><td>${escapeHtml(s.checkedAt)}</td></tr>`,
    )
    .join("");

  const incidentItems = summary.incidents.length
    ? summary.incidents
        .map(
          (i) =>
            `<li><strong>${escapeHtml(i.title)}</strong> — ${escapeHtml(i.severity)} — ${escapeHtml(i.status)}` +
            `<p>${escapeHtml(i.body)}</p>` +
            `<small>started ${escapeHtml(i.startedAt)}${i.resolvedAt ? `, resolved ${escapeHtml(i.resolvedAt)}` : ""}</small></li>`,
        )
        .join("")
    : "<li>No incidents reported.</li>";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Avatrain Status</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; }
  table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
  th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #ddd; }
  .up { color: #0a7a2f; font-weight: 600; }
  .down { color: #b3221e; font-weight: 600; }
  ul { list-style: none; padding: 0; }
  li { padding: 0.75rem 0; border-bottom: 1px solid #eee; }
</style>
</head>
<body>
<h1>Avatrain Status</h1>
<h2>Services</h2>
<table>
<thead><tr><th>Service</th><th>Region</th><th>Status</th><th>Latency (ms)</th><th>Checked at</th></tr></thead>
<tbody>${serviceRows || "<tr><td colspan=\"5\">No checks reported yet.</td></tr>"}</tbody>
</table>
<h2>Incidents</h2>
<ul>${incidentItems}</ul>
</body>
</html>`;
}

export function registerStatusRoutes(app: FastifyInstance): void {
  app.get("/v1/status", async (_request, reply) => {
    const summary = await getCachedStatusSummary();
    reply.send(summary);
  });

  app.get("/status", async (_request, reply) => {
    const summary = await getCachedStatusSummary();
    reply.type("text/html").send(renderStatusHtml(summary));
  });
}
