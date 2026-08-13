-- CreateEnum
CREATE TYPE "AgeGroup" AS ENUM ('YOUNG_ADULT', 'MIDDLE_AGED', 'SENIOR');

-- CreateEnum
CREATE TYPE "AvatarRegion" AS ENUM ('GLOBAL', 'INDIA', 'NORTH_AMERICA', 'EUROPE', 'MIDDLE_EAST', 'APAC');

-- CreateEnum
CREATE TYPE "AvatarLanguage" AS ENUM ('ENGLISH', 'HINDI');

-- AlterTable
ALTER TABLE "avatars" ADD COLUMN     "age_group" "AgeGroup",
ADD COLUMN     "region" "AvatarRegion",
ADD COLUMN     "preferred_language" "AvatarLanguage";
