-- Found by packages/shared/src/db/with-auth.test.ts once RLS was actually
-- enforced for the first time (see 20260806042200_app_role_rls): Postgres
-- custom GUCs (the "app.*" settings used here) reset to an empty string ''
-- — not NULL — after a `SET LOCAL` transaction ends, once that GUC name has
-- been touched at least once on the backend/connection. A connection pool
-- reuses backends across many transactions, so ''::uuid casts in these
-- policies were one query away from throwing on any request that didn't
-- explicitly set every context field. NULLIF(..., '') normalizes '' to NULL
-- before the cast so an unset field is correctly excluded from the OR
-- instead of erroring. Affects the pre-existing "applications" policy too.
DROP POLICY tenant_isolation ON "applications";
CREATE POLICY tenant_isolation ON "applications"
  USING (org_id = NULLIF(current_setting('app.current_org_id'), '')::uuid);

DROP POLICY tenant_isolation ON "memberships";
CREATE POLICY tenant_isolation ON "memberships"
  USING (
    org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    OR user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  );

DROP POLICY tenant_isolation ON "sessions";
CREATE POLICY tenant_isolation ON "sessions"
  USING (
    org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    OR user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    OR token_hash = NULLIF(current_setting('app.session_lookup_hash', true), '')
  );
