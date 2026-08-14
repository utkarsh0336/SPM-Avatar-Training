-- CreateEnum
CREATE TYPE "ProgramType" AS ENUM ('EMPLOYEE_ONBOARDING', 'COMPLIANCE_TRAINING', 'CUSTOMER_EDUCATION', 'PARTNER_ENABLEMENT');

-- AlterTable
ALTER TABLE "curricula" ADD COLUMN     "program_type" "ProgramType";

-- CreateIndex
CREATE INDEX "curricula_org_id_program_type_idx" ON "curricula"("org_id", "program_type");
