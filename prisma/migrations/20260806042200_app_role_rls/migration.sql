-- Postgres superusers and table owners bypass RLS unconditionally, no matter
-- how many CREATE POLICY statements exist. The connection this migration
-- runs as ("avatrain", per docker-compose.yml) is both — so every RLS policy
-- added so far (including the pre-existing "applications" policy) has never
-- actually been enforced. This migration is the real fix: a separate,
-- unprivileged role for the app's *runtime* queries to connect as, while
-- migrations keep running as the superuser/owner.
--
-- packages/shared/src/db/client.ts connects using APP_DATABASE_URL (falling
-- back to DATABASE_URL only if unset). `prisma migrate` / `db:studio`
-- continue to use DATABASE_URL directly and are unaffected.
--
-- See .claude/rules/tenancy.md.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'avatrain_app') THEN
    CREATE ROLE avatrain_app WITH LOGIN PASSWORD 'avatrain_app' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE avatrain TO avatrain_app;
GRANT USAGE ON SCHEMA public TO avatrain_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO avatrain_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO avatrain_app;

-- Future tables created by migrations (which run as the owner) grant to
-- avatrain_app automatically too.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO avatrain_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO avatrain_app;

-- FORCE is the defense-in-depth half of the fix: avatrain_app is already
-- non-owner/non-superuser so ENABLE ROW LEVEL SECURITY alone already applies
-- to it, but FORCE also closes the door if table ownership ever changes.
ALTER TABLE "applications" FORCE ROW LEVEL SECURITY;
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
ALTER TABLE "sessions" FORCE ROW LEVEL SECURITY;
