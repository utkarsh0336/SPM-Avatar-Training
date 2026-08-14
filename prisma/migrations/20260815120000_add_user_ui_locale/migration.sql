-- CreateEnum
CREATE TYPE "UiLocale" AS ENUM ('EN', 'HI');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "ui_locale" "UiLocale" NOT NULL DEFAULT 'EN';
