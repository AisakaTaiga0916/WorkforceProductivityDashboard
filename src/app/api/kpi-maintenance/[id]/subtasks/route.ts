import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { moduleDisabledResponse } from "@/modules/platform/settings/system-modules-db";
import { isItProjectImplementationPillar } from "@/modules/tasks/it-task-pillar-titles";
import { kpiMainTaskLabel } from "@/modules/tasks/kpi-main-task";
import { normalizeTimeZone } from "@/modules/tasks/kpi-recurrence";
import { appendSubKpiItem, hasSubKpiAssignedTo, normalizeSubKpis } from "@/modules/tasks/kpi-subkpis";
import { listSubTaskDtos, listSubTasksPayload } from "@/modules/tasks/kpi-subtasks-rest";
import { resolveOpsPermissions } from "@/lib/ops-permissions";
import { prisma } from "@/modules/platform/db/prisma";
import { KPI_ROW_SELECT, checklistFullyComplete, snapshotIfRecurring } from "./_shared";

/** GET /api/kpi-maintenance/:id/subtasks — list sub-tasks of a board task. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { session, unauthorized } = await requireRole(["Admin", "Personnel"]);
  if (unauthorized || !session) return unauthorized;
  const perms = await resolveOpsPermissions(session);
  const { id } = await ctx.params;

  const row = await prisma.kpiMaintenance.findUnique({ where: { id }, select: KPI_ROW_SELECT });
  if (!row) return NextResponse.json({ error: "Task not found." }, { status: 404 });

  const canAccess =
    perms.canAssignWork ||
    row.assignedAgentId === perms.operator?.id ||
    hasSubKpiAssignedTo(row.subKpis, perms.operator?.id);
  if (!canAccess) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  return NextResponse.json(listSubTasksPayload(row.id, row.subKpis));
}

/** POST /api/kpi-maintenance/:id/subtasks — add a sub-task (admins only). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { session, unauthorized } = await requireRole(["Admin", "Personnel"]);
  if (unauthorized || !session) return unauthorized;
  const moduleOff = await moduleDisabledResponse("tasks");
  if (moduleOff) return moduleOff;
  const perms = await resolveOpsPermissions(session);
  if (!perms.isAdminRole) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const tz = normalizeTimeZone(new URL(req.url).searchParams.get("tz"));

  const row = await prisma.kpiMaintenance.findUnique({ where: { id }, select: KPI_ROW_SELECT });
  if (!row) return NextResponse.json({ error: "Task not found." }, { status: 404 });
  if (isItProjectImplementationPillar(row.title)) {
    return NextResponse.json(
      { error: "Use task management to edit IT Project Implementation checklists." },
      { status: 400 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    description?: string | null;
    remarks?: string | null;
    segmentId?: string | null;
    dueDate?: string | null;
    dueDateRollsWithCycle?: boolean | null;
    priority?: string | null;
  };
  const title = String(body.title ?? "").trim();
  if (!title) {
    return NextResponse.json({ error: "Sub Task title is required." }, { status: 400 });
  }
  const normalized = normalizeSubKpis(row.subKpis);
  const result = appendSubKpiItem(row.subKpis, {
    title,
    description: body.description,
    remarks: body.remarks,
    segmentId: normalized.segmented ? body.segmentId : null,
    dueDate: body.dueDate,
    dueDateRollsWithCycle: body.dueDateRollsWithCycle,
    projectPriority: body.priority,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const label = kpiMainTaskLabel(row);
  const prevComplete = checklistFullyComplete(row.subKpis, label);
  const nextComplete = checklistFullyComplete(result.json, label);
  let lastFullCompletionAt: Date | null | undefined;
  if (!prevComplete && nextComplete) lastFullCompletionAt = new Date();
  else if (prevComplete && !nextComplete) lastFullCompletionAt = null;

  await prisma.kpiMaintenance.update({
    where: { id },
    data: {
      subKpis: result.json,
      ...(nextComplete ? { rolledOverIncomplete: false } : {}),
      ...(lastFullCompletionAt !== undefined ? { lastFullCompletionAt } : {}),
    },
  });
  await snapshotIfRecurring(row, result.json, tz);

  return NextResponse.json(
    { ...listSubTasksPayload(row.id, result.json) },
    { status: 201 },
  );
}
