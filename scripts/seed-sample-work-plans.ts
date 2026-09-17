#!/usr/bin/env npx tsx
/**
 * Seed two sample Work Plans from live primary-DB fields:
 * one with Driver Present, one without.
 *
 * Usage: npx tsx scripts/seed-sample-work-plans.ts
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

import { KpiFrequency } from "@prisma/client/primary";
import {
  applyPillarOnlyTaskCreate,
  markFieldAssignmentTask,
  setTaskCount,
  wrapForPersist,
} from "../src/lib/kpi-subkpis";
import { prismaPrimary } from "../src/lib/prisma";
import {
  agentIdsFromApprovalLevels,
  normalizeApprovalLevelsForStore,
  type TravelOrderApprovalLevelDraft,
} from "../src/lib/travel-order";
import { createTravelOrderWithLocations } from "../src/lib/travel-order-db";
import {
  deriveWorkPlanOrderRequest,
  emptyPersonnelRow,
  emptyWorkPlanDraft,
  emptyWorkPlanMeta,
  parseWorkPlanMeta,
  validateWorkPlanDraft,
  type WorkPlanMeta,
} from "../src/lib/work-plan";

const CREATED_BY = "seed-work-plan";
const CREATED_BY_ROLE = "Admin";

const SEED_DRIVER_ID = "seed_wp_driver_present";
const SEED_NO_DRIVER_ID = "seed_wp_no_driver";

type SourceOrder = {
  id: string;
  created_by_agent_id: string | null;
  company_team_id: string | null;
  approval_levels: unknown;
  work_plan_meta: unknown;
};

function asDraftLevels(raw: unknown): TravelOrderApprovalLevelDraft[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row, index) => {
    const r = (row ?? {}) as Record<string, unknown>;
    return {
      level:
        typeof r.level === "number" && Number.isFinite(r.level)
          ? Math.floor(r.level)
          : index + 1,
      agentId: typeof r.agentId === "string" ? r.agentId.trim() : "",
      optional: r.optional === true,
      alternateAgentIds: Array.isArray(r.alternateAgentIds)
        ? r.alternateAgentIds
            .filter((id): id is string => typeof id === "string")
            .map((id) => id.trim())
            .filter(Boolean)
        : [],
    };
  });
}

async function loadSourceOrder(): Promise<SourceOrder> {
  const rows = await prismaPrimary.$queryRaw<SourceOrder[]>`
    SELECT id, created_by_agent_id, company_team_id, approval_levels, work_plan_meta
    FROM travel_orders
    WHERE work_plan_meta IS NOT NULL
      AND created_by NOT IN (${CREATED_BY})
    ORDER BY created_at DESC
    LIMIT 8
  `;
  const withApprovers = rows.find((row) => {
    const meta = parseWorkPlanMeta(row.work_plan_meta);
    const levels = asDraftLevels(row.approval_levels).filter((l) => l.agentId);
    return Boolean(meta && row.created_by_agent_id && levels.length > 0);
  });
  if (!withApprovers) {
    throw new Error(
      "No existing work plan found to copy fields from. Create one in the UI first, or ensure travel_orders.work_plan_meta is populated.",
    );
  }
  return withApprovers;
}

function overlaySampleCopy(
  source: WorkPlanMeta,
  kind: "driver" | "no-driver",
): WorkPlanMeta {
  if (kind === "driver") {
    const personnel = source.personnel.map((p) => emptyPersonnelRow(p));
    if (!personnel.some((p) => p.isDriver) && personnel.length > 0) {
      const idx = personnel.length > 1 ? personnel.length - 1 : 0;
      personnel[idx] = { ...personnel[idx]!, isDriver: true };
      if (!personnel[idx]!.responsibilityRole.trim()) {
        personnel[idx] = { ...personnel[idx]!, responsibilityRole: "Driver" };
      }
    }
    return emptyWorkPlanMeta({
      ...source,
      driverPresent: true,
      personnel,
      totalPersonnel: personnel.filter((p) => p.name.trim()).length,
      activityProposedWorkPlan:
        "Site inspection with company vehicle and designated driver",
      purposeObjective:
        "Transport the inspection team between venues and complete on-site checks",
      expectedOutcome:
        source.expectedOutcome?.trim() && source.expectedOutcome !== "lorem ipsum"
          ? source.expectedOutcome
          : "Signed inspection logs from each venue and a trip report",
      justification:
        source.justification?.trim() && source.justification !== "lorem ipsum"
          ? source.justification
          : "A driver is required because personnel will move between venues in a company vehicle.",
      includesTravel: false,
      travel: null,
    });
  }

  const personnel = source.personnel.map((p) =>
    emptyPersonnelRow({
      ...p,
      isDriver: false,
      responsibilityRole:
        p.responsibilityRole.trim().toLowerCase() === "driver"
          ? "Staff"
          : p.responsibilityRole,
    }),
  );
  const venues =
    source.venues.length > 0 ? [source.venues[0]!] : source.venues;
  const budgetLines = source.budgetLines.filter(
    (line) => line.particulars.trim().toLowerCase() !== "fuel",
  );
  return emptyWorkPlanMeta({
    ...source,
    driverPresent: false,
    personnel,
    totalPersonnel: personnel.filter((p) => p.name.trim()).length,
    venues,
    venueLocation: venues.map((v) => v.label).join("\n"),
    budgetLines: budgetLines.length > 0 ? budgetLines : source.budgetLines,
    activityProposedWorkPlan: "On-site process review (no driver)",
    purposeObjective:
      "Walk through current operations with the host team at a single venue",
    expectedOutcome:
      source.expectedOutcome?.trim() && source.expectedOutcome !== "lorem ipsum"
        ? source.expectedOutcome
        : "Process notes and an agreed follow-up list from the host team",
    justification:
      "No driver is assigned because the team will work on-site and will not use a company vehicle.",
    includesTravel: false,
    travel: null,
  });
}

async function upsertWorkPlan(opts: {
  kpiId: string;
  source: SourceOrder;
  sourceMeta: WorkPlanMeta;
  kind: "driver" | "no-driver";
}) {
  const { kpiId, source, sourceMeta, kind } = opts;
  const workPlan = overlaySampleCopy(sourceMeta, kind);
  const approvalLevels = normalizeApprovalLevelsForStore(
    asDraftLevels(source.approval_levels),
  );
  const confirmationByAgentId =
    sourceMeta.personInChargeAgentId?.trim() ||
    approvalLevels[0]?.agentId ||
    "";
  const draft = emptyWorkPlanDraft({ workPlan, approvalLevels, confirmationByAgentId });
  const validationError = validateWorkPlanDraft(draft);
  if (validationError) {
    throw new Error(`${kpiId}: ${validationError}`);
  }

  const workPlanMeta = draft.workPlan;
  const orderRequest = deriveWorkPlanOrderRequest(workPlanMeta);
  const title = (
    workPlanMeta.activityProposedWorkPlan.replace(/\s+/g, " ").toUpperCase() ||
    "TRAVEL ORDER"
  ).slice(0, 160);

  await prismaPrimary.kpiMaintenance.deleteMany({
    where: { OR: [{ id: kpiId }, { createdBy: CREATED_BY, title }] },
  });

  let mainTask = orderRequest.slice(0, 160);
  const colliding = await prismaPrimary.kpiMaintenance.findFirst({
    where: { title, mainTask },
    select: { id: true },
  });
  if (colliding) {
    mainTask = `${mainTask} (${new Date().toISOString().slice(0, 16).replace("T", " ")})`.slice(
      0,
      160,
    );
  }

  let subKpis = wrapForPersist({ segmented: false, flat: [] });
  subKpis = applyPillarOnlyTaskCreate(
    subKpis,
    {
      checkbox: false,
      screenshots: false,
      screenshotUpload: false,
      numerical: true,
    },
    { numericalTarget: 100 },
  );
  subKpis = setTaskCount(subKpis, 0);
  subKpis = markFieldAssignmentTask(subKpis);

  const kpi = await prismaPrimary.kpiMaintenance.create({
    data: {
      id: kpiId,
      title,
      mainTask,
      isRecurring: false,
      frequency: KpiFrequency.MONTHLY,
      subKpis,
      enableSubtaskAssignees: false,
      scopedCompanyTeamId: source.company_team_id,
      assignedAgentId: source.created_by_agent_id,
      createdBy: CREATED_BY,
      createdByRole: CREATED_BY_ROLE,
    },
  });

  const travelOrder = await createTravelOrderWithLocations({
    kpiMaintenanceId: kpi.id,
    orderRequest,
    workPlanMeta,
    approvedByAgentIds: agentIdsFromApprovalLevels(approvalLevels),
    approvalLevels,
    confirmationByAgentId: confirmationByAgentId || null,
    createdBy: CREATED_BY,
    createdByAgentId: source.created_by_agent_id,
    companyTeamId: source.company_team_id,
    status: "SUBMITTED",
    locations: [],
  });

  return {
    kpiId: kpi.id,
    travelOrderId: travelOrder.id,
    title: kpi.title,
    driverPresent: workPlanMeta.driverPresent,
    drivers: workPlanMeta.personnel.filter((p) => p.isDriver).map((p) => p.name),
    personnel: workPlanMeta.personnel.map((p) => ({
      name: p.name,
      positionDepartment: p.positionDepartment,
      responsibilityRole: p.responsibilityRole,
      isDriver: p.isDriver,
    })),
    venues: workPlanMeta.venues.map((v) => v.label),
    departmentBusinessUnit: workPlanMeta.departmentBusinessUnit,
    requestingParty: workPlanMeta.requestingParty,
    pic: workPlanMeta.personInChargeName,
    budget: workPlanMeta.budgetLines,
  };
}

async function main() {
  await prismaPrimary.$connect();
  const source = await loadSourceOrder();
  const sourceMeta = parseWorkPlanMeta(source.work_plan_meta);
  if (!sourceMeta) {
    throw new Error("Source travel order work_plan_meta could not be parsed.");
  }

  const creator = source.created_by_agent_id
    ? await prismaPrimary.agent.findUnique({
        where: { id: source.created_by_agent_id },
        select: { id: true, name: true, email: true },
      })
    : null;
  const company = source.company_team_id
    ? await prismaPrimary.team.findUnique({
        where: { id: source.company_team_id },
        select: { id: true, name: true },
      })
    : null;

  console.log("Cloning fields from existing work plan:");
  console.log(
    JSON.stringify(
      {
        sourceOrderId: source.id,
        creator,
        company,
        departmentBusinessUnit: sourceMeta.departmentBusinessUnit,
        requestingParty: sourceMeta.requestingParty,
        pic: {
          id: sourceMeta.personInChargeAgentId,
          name: sourceMeta.personInChargeName,
        },
        personnel: sourceMeta.personnel,
        venues: sourceMeta.venues,
        budgetLines: sourceMeta.budgetLines,
        approvalLevels: asDraftLevels(source.approval_levels),
      },
      null,
      2,
    ),
  );

  const created = [
    await upsertWorkPlan({
      kpiId: SEED_DRIVER_ID,
      source,
      sourceMeta,
      kind: "driver",
    }),
    await upsertWorkPlan({
      kpiId: SEED_NO_DRIVER_ID,
      source,
      sourceMeta,
      kind: "no-driver",
    }),
  ];

  console.log("\nSeeded work plans:\n", JSON.stringify(created, null, 2));
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prismaPrimary.$disconnect();
  });
