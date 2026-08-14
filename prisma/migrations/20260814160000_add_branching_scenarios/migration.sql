-- CreateTable
CREATE TABLE "scenario_steps" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "objective_id" UUID NOT NULL,
    "order" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scenario_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scenario_branches" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "from_step_id" UUID NOT NULL,
    "order" INTEGER NOT NULL,
    "match_criteria" TEXT NOT NULL,
    "next_step_id" UUID,
    "outcome" "ObjectiveProgressVerdict",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scenario_branches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scenario_steps_org_id_idx" ON "scenario_steps"("org_id");

-- CreateIndex
CREATE INDEX "scenario_steps_objective_id_idx" ON "scenario_steps"("objective_id");

-- CreateIndex
CREATE UNIQUE INDEX "scenario_steps_objective_id_order_key" ON "scenario_steps"("objective_id", "order");

-- CreateIndex
CREATE INDEX "scenario_branches_org_id_idx" ON "scenario_branches"("org_id");

-- CreateIndex
CREATE INDEX "scenario_branches_from_step_id_idx" ON "scenario_branches"("from_step_id");

-- CreateIndex
CREATE UNIQUE INDEX "scenario_branches_from_step_id_order_key" ON "scenario_branches"("from_step_id", "order");

-- AddForeignKey
ALTER TABLE "scenario_steps" ADD CONSTRAINT "scenario_steps_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenario_steps" ADD CONSTRAINT "scenario_steps_objective_id_fkey" FOREIGN KEY ("objective_id") REFERENCES "objectives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenario_branches" ADD CONSTRAINT "scenario_branches_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenario_branches" ADD CONSTRAINT "scenario_branches_from_step_id_fkey" FOREIGN KEY ("from_step_id") REFERENCES "scenario_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenario_branches" ADD CONSTRAINT "scenario_branches_next_step_id_fkey" FOREIGN KEY ("next_step_id") REFERENCES "scenario_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;
