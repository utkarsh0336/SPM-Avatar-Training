-- RLS helpers — see .claude/rules/tenancy.md.
-- "organizations" is the tenant root and is intentionally not RLS-scoped.
ALTER TABLE "applications" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "applications"
  USING (org_id = current_setting('app.current_org_id')::uuid);
