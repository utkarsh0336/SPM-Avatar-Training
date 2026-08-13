-- CreateEnum
CREATE TYPE "ReadingLevel" AS ENUM ('SIMPLE', 'STANDARD', 'ADVANCED');

-- AlterTable
ALTER TABLE "avatars" ADD COLUMN     "reading_level" "ReadingLevel";
