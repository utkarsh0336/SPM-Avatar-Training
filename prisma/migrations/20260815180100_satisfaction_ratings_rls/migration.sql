-- RLS for "satisfaction_ratings" — see .claude/rules/tenancy.md and
-- .claude/specs/user-satisfaction.md. Mirrors "turn_metrics"'s policy shape (single-org-context
-- table, no user-only fallback needed).

ALTER TABLE "satisfaction_ratings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "satisfaction_ratings" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "satisfaction_ratings"
  USING (org_id = NULLIF(current_setting('app.current_org_id'), '')::uuid);
