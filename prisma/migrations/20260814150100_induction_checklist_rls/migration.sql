-- RLS for "induction_checklists", "checklist_items", and
-- "checklist_item_progress" — see .claude/rules/tenancy.md and
-- .claude/specs/induction-checklist.md. Mirrors "curricula"/"objectives"/
-- "objective_progress"'s policy shape (single-org-context table, no
-- user-only fallback needed).

ALTER TABLE "induction_checklists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "induction_checklists" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "induction_checklists"
  USING (org_id = NULLIF(current_setting('app.current_org_id'), '')::uuid);

ALTER TABLE "checklist_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "checklist_items" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "checklist_items"
  USING (org_id = NULLIF(current_setting('app.current_org_id'), '')::uuid);

ALTER TABLE "checklist_item_progress" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "checklist_item_progress" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "checklist_item_progress"
  USING (org_id = NULLIF(current_setting('app.current_org_id'), '')::uuid);
