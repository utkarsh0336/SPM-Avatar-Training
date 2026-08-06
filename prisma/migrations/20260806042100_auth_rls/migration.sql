-- RLS helpers — see .claude/rules/tenancy.md.
-- "users" is a global identity root and is intentionally not RLS-scoped.
--
-- Unlike "applications"'s policy, these use current_setting(name, true)
-- (missing_ok) because login/signup must tolerate partial auth context —
-- app.current_user_id set but app.current_org_id not yet known — without
-- erroring. See packages/shared/src/db/with-auth.ts.
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "memberships"
  USING (
    org_id = current_setting('app.current_org_id', true)::uuid
    OR user_id = current_setting('app.current_user_id', true)::uuid
  );

ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "sessions"
  USING (
    org_id = current_setting('app.current_org_id', true)::uuid
    OR user_id = current_setting('app.current_user_id', true)::uuid
    OR token_hash = current_setting('app.session_lookup_hash', true)
  );
