-- CreateEnum
CREATE TYPE "AvatarStyle" AS ENUM ('REALISTIC', 'ANIMATED', 'STYLIZED_3D');

-- CreateEnum
CREATE TYPE "AvatarGender" AS ENUM ('FEMALE', 'MALE', 'NEUTRAL');

-- CreateEnum
CREATE TYPE "HairStyle" AS ENUM ('SHORT', 'MEDIUM', 'LONG', 'CURLY', 'WAVY', 'BALD');

-- CreateEnum
CREATE TYPE "Outfit" AS ENUM ('BUSINESS_FORMAL', 'BUSINESS_CASUAL', 'SMART_PROFESSIONAL', 'TECH_CREATIVE', 'ACADEMIC_EDUCATOR');

-- CreateEnum
CREATE TYPE "Expertise" AS ENUM ('HR_LEAVE_POLICY', 'SALES_NEGOTIATION', 'COMPLIANCE_LEGAL', 'PRODUCT_TRAINING', 'CUSTOMER_SUPPORT', 'LEADERSHIP_MANAGEMENT', 'FINANCE_ACCOUNTING', 'IT_TECHNOLOGY', 'MARKETING_BRANDING');

-- CreateEnum
CREATE TYPE "VoiceTone" AS ENUM ('DEEP', 'NEUTRAL', 'WARM');

-- CreateEnum
CREATE TYPE "AvatarStatus" AS ENUM ('DRAFT', 'ACTIVE');

-- CreateEnum
CREATE TYPE "AvatarPreviewProvider" AS ENUM ('NONE', 'READY_PLAYER_ME');

-- CreateTable
CREATE TABLE "avatars" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "name" TEXT,
    "style" "AvatarStyle",
    "gender" "AvatarGender",
    "skin_tone" TEXT,
    "hair_style" "HairStyle",
    "hair_color" TEXT,
    "outfit" "Outfit",
    "expertise" "Expertise",
    "voice" "VoiceTone",
    "status" "AvatarStatus" NOT NULL DEFAULT 'DRAFT',
    "last_visited_step" INTEGER NOT NULL DEFAULT 1,
    "preview_provider" "AvatarPreviewProvider" NOT NULL DEFAULT 'NONE',
    "external_avatar_id" TEXT,
    "avatar_model_url" TEXT,
    "avatar_snapshot_url" TEXT,
    "preview_generated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "avatars_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "avatars_org_id_idx" ON "avatars"("org_id");

-- CreateIndex
CREATE INDEX "avatars_org_id_created_by_id_status_idx" ON "avatars"("org_id", "created_by_id", "status");

-- AddForeignKey
ALTER TABLE "avatars" ADD CONSTRAINT "avatars_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
