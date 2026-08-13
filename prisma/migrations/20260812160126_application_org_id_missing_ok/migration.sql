-- Fixes a latent bug the previous migration's own publishable_key_lookup
-- addition exposed: "applications"' org_id clause used
-- current_setting('app.current_org_id') with NO missing-ok flag. That never
-- threw before because every prior caller went through withOrg(), which
-- always SET LOCALs app.current_org_id first. routes/embed.ts's public path
-- uses withAuthContext({ publishableKeyLookup }) instead — it never touches
-- app.current_org_id at all — so on a connection where that GUC has never
-- been set even once, plain current_setting() throws
-- "unrecognized configuration parameter" instead of returning NULL/''.
-- Adds the same current_setting(..., true) missing-ok flag "sessions" and
-- "memberships" already use (20260806042300_rls_empty_string_guard).
DROP POLICY tenant_isolation ON "applications";
CREATE POLICY tenant_isolation ON "applications"
  USING (
    org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    OR publishable_key = NULLIF(current_setting('app.publishable_key_lookup', true), '')
  );
