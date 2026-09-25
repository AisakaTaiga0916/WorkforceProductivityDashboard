import { KpiFrequency } from "@prisma/client/primary";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import {
  applyPillarOnlyTaskCreate,
  setTaskCount,
  wrapForPersist,
  markFieldAssignmentTask,
} from "@/lib/kpi-subkpis";
import { resolveOpsPermissions } from "@/lib/ops-permissions";
import { prisma } from "@/lib/prisma";
import { resolveAgentDesignatedCompanyId } from "@/lib/staff-company-scope";
import {
  agentIdsFromApprovalLevels,
  normalizeApprovalLevelsForStore,
  type TravelOrderApprovalLevelDraft,
} from "@/lib/travel-order";
import {
  createTravelOrderWithLocations,
  serializeTravelOrder,
  updateTravelOrderAttachments,
} from "@/lib/travel-order-db";
import { createRfpFromSubmittedTravelOrder } from "@/lib/travel-order-rfp";
import {
  MAX_TRAVEL_ORDER_ATTACHMENTS,
  persistTravelOrderAttachment,
  removeTravelOrderUploadDir,
} from "@/lib/travel-order-uploads";
import {
  deriveWorkPlanOrderRequest,
  emptyWorkPlanDraft,
  emptyWorkPlanMeta,
  normalizeWorkPlanMetaForStore,
  validateWorkPlanDraft,
  type WorkPlanMeta,
} from "@/lib/work-plan";

/**
 * POST /api/kpi-maintenance/field-assignment
 * Creates a one-off Task Management card + linked Work Plan for Management Approval.
 * Available to all Admin/Personnel; auto-assigns the card to the creator.
 */
export async function POST(req: Request) {
  const { session, unauthorized } = await requireRole(["Admin", "Personnel"]);
  if (unauthorized || !session) return unauthorized;
  const perms = await resolveOpsPermissions(session);

  const creatorAgentId = perms.operator?.id ?? null;
  if (!creatorAgentId) {
    return NextResponse.json(
      {
        error:
          "Your account is not linked to a personnel record. Cannot create a travel order.",
      },
      { status: 400 },
    );
  }

  const creatorCompanyId = await resolveAgentDesignatedCompanyId(creatorAgentId);
  if (!creatorCompanyId) {
    return NextResponse.json(
      {
        error:
          "Your account has no company assignment. Ask an admin to set your company first.",
      },
      { status: 400 },
    );
  }

  const form = await req.formData();
  const workPlanRaw = String(form.get("workPlanJson") ?? "").trim();
  if (!workPlanRaw) {
    return NextResponse.json(
      { error: "Travel Order details are required (workPlanJson)." },
      { status: 400 },
    );
  }

  let workPlanParsed: WorkPlanMeta;
  try {
    workPlanParsed = emptyWorkPlanMeta(JSON.parse(workPlanRaw) as Partial<WorkPlanMeta>);
  } catch {
    return NextResponse.json({ error: "Invalid workPlanJson." }, { status: 400 });
  }

  let approvalLevelsDraft: TravelOrderApprovalLevelDraft[] = [];
  const approvalLevelsRaw = String(form.get("approvalLevels") ?? "").trim();
  if (approvalLevelsRaw) {
    try {
      const parsed = JSON.parse(approvalLevelsRaw) as unknown;
      if (!Array.isArray(parsed)) {
        return NextResponse.json({ error: "Invalid approvalLevels." }, { status: 400 });
      }
      approvalLevelsDraft = parsed.map((row, index) => {
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
    } catch {
      return NextResponse.json({ error: "Invalid approvalLevels." }, { status: 400 });
    }
  }

  const confirmationByAgentId = String(form.get("confirmationByAgentId") ?? "").trim();
  const draft = emptyWorkPlanDraft({
    workPlan: workPlanParsed,
    approvalLevels: approvalLevelsDraft,
    confirmationByAgentId,
  });
  const validationError = validateWorkPlanDraft(draft);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const workPlanMeta = normalizeWorkPlanMetaForStore(draft.workPlan);
  const orderRequest =
    String(form.get("orderRequest") ?? "").trim() || deriveWorkPlanOrderRequest(workPlanMeta);
  // Preserve optional labels from the client when present.
  let clientLabels: Array<{ level: number; label?: string | null }> = [];
  if (approvalLevelsRaw) {
    try {
      const parsed = JSON.parse(approvalLevelsRaw) as Array<{
        level?: number;
        label?: string | null;
      }>;
      if (Array.isArray(parsed)) {
        clientLabels = parsed.map((row, index) => ({
          level:
            typeof row.level === "number" && Number.isFinite(row.level)
              ? Math.floor(row.level)
              : index + 1,
          label: typeof row.label === "string" ? row.label : null,
        }));
      }
    } catch {
      /* already validated above */
    }
  }
  const approvalLevels = normalizeApprovalLevelsForStore(
    draft.approvalLevels.map((lvl) => {
      const label =
        clientLabels.find((c) => c.level === lvl.level)?.label?.trim() ||
        `Level ${lvl.level}`;
      return { ...lvl, label };
    }),
  );
  const approvedByAgentIds = agentIdsFromApprovalLevels(approvalLevels);

  const mainTask = String(form.get("mainTask") ?? "").trim() || orderRequest.slice(0, 160);
  const title =
    (mainTask.replace(/\s+/g, " ").toUpperCase() || String(form.get("title") ?? "").trim()) ||
    "TRAVEL ORDER";

  const scopedCompanyTeamId = creatorCompanyId;
  const picAgentId = workPlanMeta.personInChargeAgentId?.trim() || null;
  const confirmerId = draft.confirmationByAgentId.trim();

  const [approvers, pic, confirmer] = await Promise.all([
    prisma.agent.findMany({
      where: { id: { in: approvedByAgentIds } },
      select: { id: true },
    }),
    picAgentId
      ? prisma.agent.findUnique({
          where: { id: picAgentId },
          select: { id: true, name: true },
        })
      : Promise.resolve(null),
    prisma.agent.findUnique({
      where: { id: confirmerId },
      select: { id: true },
    }),
  ]);
  if (approvers.length !== approvedByAgentIds.length) {
    return NextResponse.json(
      { error: "One or more selected approvers were not found." },
      { status: 400 },
    );
  }
  if (!confirmer) {
    return NextResponse.json(
      { error: "The selected confirmer was not found." },
      { status: 400 },
    );
  }
  if (picAgentId) {
    if (!pic) {
      return NextResponse.json({ error: "Person-in-Charge was not found." }, { status: 400 });
    }
    if (!workPlanMeta.personInChargeName?.trim()) {
      workPlanMeta.personInChargeName = pic.name;
    }
  }

  const pendingOrderAttachments: File[] = [];
  for (const [key, value] of form.entries()) {
    if (!(value instanceof File) || value.size <= 0) continue;
    if (key === "attachment" || key === "attachments") {
      pendingOrderAttachments.push(value);
    }
  }

  let finalMainTask = mainTask;
  const existing = await prisma.kpiMaintenance.findFirst({
    where: { title, mainTask: finalMainTask },
    select: { id: true },
  });
  if (existing) {
    finalMainTask = `${mainTask} (${new Date().toISOString().slice(0, 16).replace("T", " ")})`;
  }

  const createdBy =
    typeof session.user?.email === "string" && session.user.email.trim()
      ? session.user.email.trim()
      : "admin";
  const createdByRole = perms.isAdminRole ? "Admin" : "Personnel";

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

  const kpi = await prisma.kpiMaintenance.create({
    data: {
      title,
      mainTask: finalMainTask,
      isRecurring: false,
      frequency: KpiFrequency.MONTHLY,
      subKpis,
      enableSubtaskAssignees: false,
      scopedCompanyTeamId,
      assignedAgentId: creatorAgentId,
      createdBy,
      createdByRole,
    },
  });

  let travelOrder: Awaited<ReturnType<typeof createTravelOrderWithLocations>>;
  try {
    travelOrder = await createTravelOrderWithLocations({
      kpiMaintenanceId: kpi.id,
      orderRequest,
      workPlanMeta,
      approvedByAgentIds,
      approvalLevels,
      confirmationByAgentId: confirmerId,
      createdBy,
      createdByAgentId: creatorAgentId,
      companyTeamId: scopedCompanyTeamId,
      status: "SUBMITTED",
      locations: [],
    });
  } catch (err) {
    await prisma.kpiMaintenance.delete({ where: { id: kpi.id } }).catch(() => undefined);
    const message = err instanceof Error ? err.message : "Could not create the travel order.";
    console.error("[field-assignment] work plan create failed:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  try {
    if (pendingOrderAttachments.length > 0) {
      if (pendingOrderAttachments.length > MAX_TRAVEL_ORDER_ATTACHMENTS) {
        throw new Error(`You can attach at most ${MAX_TRAVEL_ORDER_ATTACHMENTS} files.`);
      }
      const savedResults = await Promise.all(
        pendingOrderAttachments
          .slice(0, MAX_TRAVEL_ORDER_ATTACHMENTS)
          .map((file) => persistTravelOrderAttachment(kpi.id, travelOrder.id, file)),
      );
      const uploaded = [];
      for (const saved of savedResults) {
        if ("error" in saved) {
          throw new Error(saved.error);
        }
        uploaded.push(saved);
      }
      const nextAttachments = [...(travelOrder.attachments ?? []), ...uploaded];
      await updateTravelOrderAttachments(travelOrder.id, nextAttachments);
      travelOrder = { ...travelOrder, attachments: nextAttachments };
    }
  } catch (err) {
    await prisma.travelOrder.delete({ where: { id: travelOrder.id } }).catch(() => undefined);
    await prisma.kpiMaintenance.delete({ where: { id: kpi.id } }).catch(() => undefined);
    await removeTravelOrderUploadDir(kpi.id, travelOrder.id).catch(() => undefined);
    const message = err instanceof Error ? err.message : "Could not save work-plan attachments.";
    console.error("[field-assignment] upload/attach failed; rolled back:", err);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  let linkedRfp: Awaited<ReturnType<typeof createRfpFromSubmittedTravelOrder>> | null = null;
  try {
    linkedRfp = await createRfpFromSubmittedTravelOrder(travelOrder);
  } catch (err) {
    console.error("[field-assignment] auto-create RFP from travel order failed:", err);
  }

  return NextResponse.json(
    {
      kpi: { id: kpi.id, isFieldAssignment: true },
      travelOrder: serializeTravelOrder(travelOrder),
      linkedRfp,
      linkedRfpError: linkedRfp
        ? undefined
        : "Travel order was created, but the linked Request for Payment could not be created. Open the travel order to retry.",
    },
    { status: 201 },
  );
}
