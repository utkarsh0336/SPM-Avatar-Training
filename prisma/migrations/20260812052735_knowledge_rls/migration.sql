-- RLS for "knowledge_documents" and "knowledge_chunks" — see
-- .claude/rules/tenancy.md and .claude/specs/knowledge-management.md. Mirrors
-- "avatars"'s policy shape (single-org-context table, no user-only fallback
-- needed).
--
-- Note: Prisma's migrate diff engine does not see the HNSW index created by
-- hand in 20260812052645_add_knowledge_management (it lives on an
-- Unsupported("vector(384)") column, which Prisma treats as opaque). Left to
-- itself, `prisma migrate dev` will propose "DROP INDEX
-- knowledge_chunks_embedding_hnsw_idx" on every future schema change purely
-- because it can't see it exists. Always review generated migration SQL
-- before applying — never accept that drop.

ALTER TABLE "knowledge_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_documents" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "knowledge_documents"
  USING (org_id = NULLIF(current_setting('app.current_org_id'), '')::uuid);

ALTER TABLE "knowledge_chunks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_chunks" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "knowledge_chunks"
  USING (org_id = NULLIF(current_setting('app.current_org_id'), '')::uuid);
