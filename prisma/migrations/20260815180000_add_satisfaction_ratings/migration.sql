-- CreateTable
CREATE TABLE "satisfaction_ratings" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "training_session_id" UUID,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "satisfaction_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "satisfaction_ratings_org_id_created_at_idx" ON "satisfaction_ratings"("org_id", "created_at");

-- AddForeignKey
ALTER TABLE "satisfaction_ratings" ADD CONSTRAINT "satisfaction_ratings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "satisfaction_ratings" ADD CONSTRAINT "satisfaction_ratings_training_session_id_fkey" FOREIGN KEY ("training_session_id") REFERENCES "training_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
