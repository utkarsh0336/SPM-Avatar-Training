-- CreateTable
CREATE TABLE "induction_checklists" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "curriculum_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "induction_checklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_items" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "checklist_id" UUID NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_item_progress" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "learner_id" UUID NOT NULL,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checklist_item_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "induction_checklists_curriculum_id_key" ON "induction_checklists"("curriculum_id");

-- CreateIndex
CREATE INDEX "induction_checklists_org_id_idx" ON "induction_checklists"("org_id");

-- CreateIndex
CREATE INDEX "checklist_items_org_id_idx" ON "checklist_items"("org_id");

-- CreateIndex
CREATE INDEX "checklist_items_checklist_id_idx" ON "checklist_items"("checklist_id");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_items_checklist_id_order_key" ON "checklist_items"("checklist_id", "order");

-- CreateIndex
CREATE INDEX "checklist_item_progress_org_id_idx" ON "checklist_item_progress"("org_id");

-- CreateIndex
CREATE INDEX "checklist_item_progress_learner_id_idx" ON "checklist_item_progress"("learner_id");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_item_progress_item_id_learner_id_key" ON "checklist_item_progress"("item_id", "learner_id");

-- AddForeignKey
ALTER TABLE "induction_checklists" ADD CONSTRAINT "induction_checklists_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "induction_checklists" ADD CONSTRAINT "induction_checklists_curriculum_id_fkey" FOREIGN KEY ("curriculum_id") REFERENCES "curricula"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_checklist_id_fkey" FOREIGN KEY ("checklist_id") REFERENCES "induction_checklists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_item_progress" ADD CONSTRAINT "checklist_item_progress_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_item_progress" ADD CONSTRAINT "checklist_item_progress_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "checklist_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_item_progress" ADD CONSTRAINT "checklist_item_progress_learner_id_fkey" FOREIGN KEY ("learner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
