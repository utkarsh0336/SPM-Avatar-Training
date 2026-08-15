-- CreateTable
CREATE TABLE "knowledge_access_events" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "training_session_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_access_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_access_events_org_id_document_id_idx" ON "knowledge_access_events"("org_id", "document_id");

-- CreateIndex
CREATE INDEX "knowledge_access_events_org_id_created_at_idx" ON "knowledge_access_events"("org_id", "created_at");

-- AddForeignKey
ALTER TABLE "knowledge_access_events" ADD CONSTRAINT "knowledge_access_events_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_access_events" ADD CONSTRAINT "knowledge_access_events_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_access_events" ADD CONSTRAINT "knowledge_access_events_training_session_id_fkey" FOREIGN KEY ("training_session_id") REFERENCES "training_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
