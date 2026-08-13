-- AlterEnum
ALTER TYPE "AvatarStatus" ADD VALUE 'ARCHIVED';

-- Note: `prisma migrate dev`'s diff engine also generated a
-- `DROP INDEX "knowledge_chunks_embedding_hnsw_idx"` here — a false
-- positive. That index is created by raw SQL in
-- 20260812052645_add_knowledge_management/migration.sql against
-- KnowledgeChunk.embedding, which is Prisma `Unsupported("vector(384)")`
-- (pgvector has no native Prisma type) — the diff engine can't see the
-- index as schema-declared and (wrongly) proposes dropping it on every
-- subsequent migration. Deliberately removed from this migration; do not
-- re-add it.
