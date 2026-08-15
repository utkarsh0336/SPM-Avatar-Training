-- RLS for "turn_metrics" — see .claude/rules/tenancy.md and
-- .claude/specs/ai-performance-analytics.md. Mirrors "knowledge_access_events"'s policy shape
-- (single-org-context table, no user-only fallback needed).

ALTER TABLE "turn_metrics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "turn_metrics" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "turn_metrics"
  USING (org_id = NULLIF(current_setting('app.current_org_id'), '')::uuid);
