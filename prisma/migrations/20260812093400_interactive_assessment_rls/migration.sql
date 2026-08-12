-- RLS for "curricula", "objectives", and "objective_progress" — see
-- .claude/rules/tenancy.md and .claude/specs/interactive-assessment.md. Mirrors
-- "knowledge_documents"/"knowledge_chunks"'s policy shape (single-org-context
-- table, no user-only fallback needed).

ALTER TABLE "curricula" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "curricula" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "curricula"
  USING (org_id = NULLIF(current_setting('app.current_org_id'), '')::uuid);

ALTER TABLE "objectives" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "objectives" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "objectives"
  USING (org_id = NULLIF(current_setting('app.current_org_id'), '')::uuid);

ALTER TABLE "objective_progress" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "objective_progress" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "objective_progress"
  USING (org_id = NULLIF(current_setting('app.current_org_id'), '')::uuid);
