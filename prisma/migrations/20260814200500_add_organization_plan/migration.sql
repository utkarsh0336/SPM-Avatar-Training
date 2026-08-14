-- CreateEnum
CREATE TYPE "OrganizationPlan" AS ENUM ('STARTER', 'PRO', 'ENTERPRISE');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "plan" "OrganizationPlan" NOT NULL DEFAULT 'STARTER';
