-- RLS for "avatars" — see .claude/rules/tenancy.md and
-- .claude/specs/avatar-builder-customization.md. Mirrors "applications"'s
-- policy shape (single-org-context table, no user-only fallback needed) and
-- already applies the NULLIF(..., '') fix from 20260806042300 up front since
-- this table is created after that fix landed.
ALTER TABLE "avatars" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "avatars" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "avatars"
  USING (org_id = NULLIF(current_setting('app.current_org_id'), '')::uuid);
