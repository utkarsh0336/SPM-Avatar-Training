-- Extends "applications"' tenant_isolation policy with a second lookup
-- path: a public embed request (apps/api/src/routes/embed.ts) knows only
-- the Application's publishableKey, not its orgId — finding the row IS
-- what reveals the org. Same "find-then-scope" shape already established
-- for "sessions"' token_hash / app.session_lookup_hash in
-- 20260806042300_rls_empty_string_guard/migration.sql. The new clause uses
-- current_setting(..., true) (missing-ok) since a connection that has never
-- touched app.publishable_key_lookup at all must not throw — see that
-- migration's own doc comment on Postgres GUC semantics under pooling.
DROP POLICY tenant_isolation ON "applications";
CREATE POLICY tenant_isolation ON "applications"
  USING (
    org_id = NULLIF(current_setting('app.current_org_id'), '')::uuid
    OR publishable_key = NULLIF(current_setting('app.publishable_key_lookup', true), '')
  );
