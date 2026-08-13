-- AlterTable
ALTER TABLE "applications" ADD COLUMN     "allowed_origins" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "avatar_id" UUID,
ADD COLUMN     "is_enabled" BOOLEAN NOT NULL DEFAULT true;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_avatar_id_fkey" FOREIGN KEY ("avatar_id") REFERENCES "avatars"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Note: `prisma migrate diff` also proposed a
-- `DROP INDEX "knowledge_chunks_embedding_hnsw_idx"` here — the same false
-- positive documented in 20260812152333_avatar_archive_status/migration.sql
-- (the diff engine can't see indexes on a Prisma `Unsupported` column type).
-- Deliberately omitted; do not re-add it.
