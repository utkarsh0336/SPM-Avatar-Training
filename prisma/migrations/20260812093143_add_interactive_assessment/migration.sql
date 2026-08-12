-- CreateEnum
CREATE TYPE "ObjectiveProgressVerdict" AS ENUM ('PASS', 'RETRY');

-- Prisma's migrate diff engine does not see the HNSW index on
-- knowledge_chunks.embedding (an Unsupported("vector(384)") column is
-- opaque to it) and proposed "DROP INDEX knowledge_chunks_embedding_hnsw_idx"
-- here purely because it can't see the index exists — exactly the trap
-- 20260812052735_knowledge_rls's own comment warned about. Deliberately
-- removed; never accept that drop.

-- CreateTable
CREATE TABLE "curricula" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "avatar_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "curricula_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "objectives" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "curriculum_id" UUID NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "teaching_content" TEXT NOT NULL,
    "check_question" TEXT NOT NULL,
    "grading_criteria" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "objectives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "objective_progress" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "objective_id" UUID NOT NULL,
    "learner_id" UUID NOT NULL,
    "verdict" "ObjectiveProgressVerdict" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "feedback" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "objective_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "curricula_avatar_id_key" ON "curricula"("avatar_id");

-- CreateIndex
CREATE INDEX "curricula_org_id_idx" ON "curricula"("org_id");

-- CreateIndex
CREATE INDEX "objectives_org_id_idx" ON "objectives"("org_id");

-- CreateIndex
CREATE INDEX "objectives_curriculum_id_idx" ON "objectives"("curriculum_id");

-- CreateIndex
CREATE UNIQUE INDEX "objectives_curriculum_id_order_key" ON "objectives"("curriculum_id", "order");

-- CreateIndex
CREATE INDEX "objective_progress_org_id_idx" ON "objective_progress"("org_id");

-- CreateIndex
CREATE INDEX "objective_progress_learner_id_idx" ON "objective_progress"("learner_id");

-- CreateIndex
CREATE UNIQUE INDEX "objective_progress_objective_id_learner_id_key" ON "objective_progress"("objective_id", "learner_id");

-- AddForeignKey
ALTER TABLE "curricula" ADD CONSTRAINT "curricula_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curricula" ADD CONSTRAINT "curricula_avatar_id_fkey" FOREIGN KEY ("avatar_id") REFERENCES "avatars"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objectives" ADD CONSTRAINT "objectives_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objectives" ADD CONSTRAINT "objectives_curriculum_id_fkey" FOREIGN KEY ("curriculum_id") REFERENCES "curricula"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objective_progress" ADD CONSTRAINT "objective_progress_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objective_progress" ADD CONSTRAINT "objective_progress_objective_id_fkey" FOREIGN KEY ("objective_id") REFERENCES "objectives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objective_progress" ADD CONSTRAINT "objective_progress_learner_id_fkey" FOREIGN KEY ("learner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
