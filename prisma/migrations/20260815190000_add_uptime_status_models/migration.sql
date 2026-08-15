-- CreateEnum
CREATE TYPE "UptimeCheckStatus" AS ENUM ('UP', 'DOWN');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('MINOR', 'MAJOR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('INVESTIGATING', 'IDENTIFIED', 'MONITORING', 'RESOLVED');

-- CreateTable
CREATE TABLE "uptime_checks" (
    "id" UUID NOT NULL,
    "region" "DataRegion" NOT NULL,
    "service" TEXT NOT NULL,
    "status" "UptimeCheckStatus" NOT NULL,
    "latency_ms" INTEGER,
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uptime_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_incidents" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "severity" "IncidentSeverity" NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'INVESTIGATING',
    "affected_regions" "DataRegion"[],
    "body" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "status_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "uptime_checks_service_region_checked_at_idx" ON "uptime_checks"("service", "region", "checked_at");

-- CreateIndex
CREATE INDEX "uptime_checks_checked_at_idx" ON "uptime_checks"("checked_at");

-- CreateIndex
CREATE INDEX "status_incidents_status_started_at_idx" ON "status_incidents"("status", "started_at");
