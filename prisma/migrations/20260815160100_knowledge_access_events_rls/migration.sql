-- RLS for "knowledge_access_events" — see .claude/rules/tenancy.md and
-- .claude/specs/dashboard-analytics.md. Mirrors "training_sessions"/"messages"'s policy shape
-- (single-org-context table, no user-only fallback needed).

ALTER TABLE "knowledge_access_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_access_events" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "knowledge_access_events"
  USING (org_id = NULLIF(current_setting('app.current_org_id'), '')::uuid);
