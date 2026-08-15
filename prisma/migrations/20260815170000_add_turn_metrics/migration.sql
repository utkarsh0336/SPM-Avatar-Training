-- CreateTable
CREATE TABLE "turn_metrics" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "training_session_id" UUID,
    "turn_id" TEXT NOT NULL,
    "stt_ms" INTEGER,
    "retrieval_ms" INTEGER,
    "llm_first_token_ms" INTEGER,
    "tts_first_chunk_ms" INTEGER,
    "total_ms" INTEGER NOT NULL,
    "grounded" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "turn_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "turn_metrics_org_id_created_at_idx" ON "turn_metrics"("org_id", "created_at");

-- AddForeignKey
ALTER TABLE "turn_metrics" ADD CONSTRAINT "turn_metrics_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turn_metrics" ADD CONSTRAINT "turn_metrics_training_session_id_fkey" FOREIGN KEY ("training_session_id") REFERENCES "training_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
