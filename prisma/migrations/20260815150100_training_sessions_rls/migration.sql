-- RLS for "training_sessions", "messages", and "training_session_pins" — see
-- .claude/rules/tenancy.md and .claude/specs/video-chat-session.md (Milestone 2). Mirrors
-- "scenario_steps"/"scenario_branches"'s policy shape (single-org-context table, no user-only
-- fallback needed).

ALTER TABLE "training_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "training_sessions" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "training_sessions"
  USING (org_id = NULLIF(current_setting('app.current_org_id'), '')::uuid);

ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "messages"
  USING (org_id = NULLIF(current_setting('app.current_org_id'), '')::uuid);

ALTER TABLE "training_session_pins" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "training_session_pins" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "training_session_pins"
  USING (org_id = NULLIF(current_setting('app.current_org_id'), '')::uuid);
