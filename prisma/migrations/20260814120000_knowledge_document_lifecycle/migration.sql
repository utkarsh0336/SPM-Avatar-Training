-- AlterTable
-- category/tags are purely additive (nullable / defaulted). lineage_id,
-- version, is_latest need care: KnowledgeDocument.lineageId's
-- @default(uuid()) is a Prisma-client-side default (same as "id" itself —
-- see 20260812052645_add_knowledge_management, which never gave "id" a SQL
-- DEFAULT either), not a DB-level DEFAULT, so it can't just be added
-- NOT NULL in one step against a table that already has rows.
ALTER TABLE "knowledge_documents" ADD COLUMN     "category" VARCHAR(100),
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "lineage_id" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "is_latest" BOOLEAN NOT NULL DEFAULT true;

-- Backfill: every pre-existing document becomes version 1 of its own new
-- lineage — there's no way to infer a historical "this re-uploaded that"
-- relationship from data that predates this feature, and reusing the row's
-- own id as its lineage id is exactly correct for "sole and latest version
-- of its own lineage."
UPDATE "knowledge_documents" SET "lineage_id" = "id" WHERE "lineage_id" IS NULL;

ALTER TABLE "knowledge_documents" ALTER COLUMN "lineage_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "knowledge_documents_org_id_category_idx" ON "knowledge_documents"("org_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_documents_lineage_id_version_key" ON "knowledge_documents"("lineage_id", "version");

-- Note: `prisma migrate diff` would also propose a
-- `DROP INDEX "knowledge_chunks_embedding_hnsw_idx"` here — the same false
-- positive documented in 20260812154242_application_embed_fields/migration.sql
-- (the diff engine can't see indexes on a Prisma `Unsupported` column type).
-- Deliberately omitted; do not re-add it.
