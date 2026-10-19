-- Projects module: operational tasks vs projects split (step 2 of the split plan).
-- Creates the projects tables, enums, indexes, and foreign keys only.
-- Data classification and row migration from `kpi_maintenance` run in a later step
-- (dry-run report first, per the cutover plan).

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('PENDING', 'ON_GOING', 'FINALIZING', 'DONE');

-- CreateEnum
CREATE TYPE "ProjectPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'PENDING',
    "due_date" DATE,
    "scoped_company_team_id" TEXT,
    "lead_agent_id" TEXT,
    "active_phase_id" TEXT,
    "origin_job_order_ticket_id" TEXT,
    "legacy_kpi_maintenance_id" TEXT,
    "created_by" TEXT NOT NULL,
    "created_by_role" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_phases" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "due_date" DATE,
    "assigned_agent_id" TEXT,
    "last_delay_notified_on" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_phases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_items" (
    "id" TEXT NOT NULL,
    "phase_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'PENDING',
    "priority" "ProjectPriority",
    "due_date" DATE,
    "assigned_agent_id" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "migrated_meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "projects_legacy_kpi_maintenance_id_key" ON "projects"("legacy_kpi_maintenance_id");

-- CreateIndex
CREATE INDEX "projects_scoped_company_team_id_idx" ON "projects"("scoped_company_team_id");

-- CreateIndex
CREATE INDEX "projects_status_idx" ON "projects"("status");

-- CreateIndex
CREATE INDEX "projects_created_at_idx" ON "projects"("created_at");

-- CreateIndex
CREATE INDEX "project_phases_project_id_sort_order_idx" ON "project_phases"("project_id", "sort_order");

-- CreateIndex
CREATE INDEX "project_items_phase_id_sort_order_idx" ON "project_items"("phase_id", "sort_order");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_lead_agent_id_fkey" FOREIGN KEY ("lead_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_phases" ADD CONSTRAINT "project_phases_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_phases" ADD CONSTRAINT "project_phases_assigned_agent_id_fkey" FOREIGN KEY ("assigned_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_items" ADD CONSTRAINT "project_items_phase_id_fkey" FOREIGN KEY ("phase_id") REFERENCES "project_phases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_items" ADD CONSTRAINT "project_items_assigned_agent_id_fkey" FOREIGN KEY ("assigned_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
