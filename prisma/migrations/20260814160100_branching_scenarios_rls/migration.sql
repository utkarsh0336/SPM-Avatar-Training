-- RLS for "scenario_steps" and "scenario_branches" — see .claude/rules/tenancy.md and
-- .claude/specs/branching-scenario-questions.md. Mirrors "curricula"/"objectives"/
-- "objective_progress"'s policy shape (single-org-context table, no user-only fallback needed).

ALTER TABLE "scenario_steps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scenario_steps" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "scenario_steps"
  USING (org_id = NULLIF(current_setting('app.current_org_id'), '')::uuid);

ALTER TABLE "scenario_branches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scenario_branches" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "scenario_branches"
  USING (org_id = NULLIF(current_setting('app.current_org_id'), '')::uuid);
