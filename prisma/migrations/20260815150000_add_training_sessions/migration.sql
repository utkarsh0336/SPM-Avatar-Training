-- CreateEnum
CREATE TYPE "TrainingSessionKind" AS ENUM ('VIDEO_CHAT', 'VOICE_ONLY');

-- CreateEnum
CREATE TYPE "TrainingSessionStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'AVATAR', 'SYSTEM');

-- CreateTable
CREATE TABLE "training_sessions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "client_request_id" TEXT NOT NULL,
    "kind" "TrainingSessionKind" NOT NULL,
    "status" "TrainingSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "title" TEXT NOT NULL,
    "topic" TEXT,
    "avatar_id" UUID,
    "voice_expert_id" TEXT,
    "persona_name" TEXT NOT NULL,
    "persona_role" TEXT NOT NULL,
    "end_reason" TEXT,
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "training_session_id" UUID NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_session_pins" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "training_session_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_session_pins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "training_sessions_org_id_kind_status_idx" ON "training_sessions"("org_id", "kind", "status");

-- CreateIndex
CREATE INDEX "training_sessions_org_id_kind_updated_at_idx" ON "training_sessions"("org_id", "kind", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "training_sessions_org_id_client_request_id_key" ON "training_sessions"("org_id", "client_request_id");

-- CreateIndex
CREATE INDEX "messages_org_id_training_session_id_idx" ON "messages"("org_id", "training_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_training_session_id_sequence_key" ON "messages"("training_session_id", "sequence");

-- CreateIndex
CREATE INDEX "training_session_pins_org_id_idx" ON "training_session_pins"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "training_session_pins_user_id_training_session_id_key" ON "training_session_pins"("user_id", "training_session_id");

-- AddForeignKey
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_avatar_id_fkey" FOREIGN KEY ("avatar_id") REFERENCES "avatars"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_training_session_id_fkey" FOREIGN KEY ("training_session_id") REFERENCES "training_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_session_pins" ADD CONSTRAINT "training_session_pins_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_session_pins" ADD CONSTRAINT "training_session_pins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_session_pins" ADD CONSTRAINT "training_session_pins_training_session_id_fkey" FOREIGN KEY ("training_session_id") REFERENCES "training_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
