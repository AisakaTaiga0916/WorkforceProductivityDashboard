import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { moduleDisabledResponse } from "@/modules/platform/settings/system-modules-db";
import { isItProjectImplementationPillar } from "@/modules/tasks/it-task-pillar-titles";
import { kpiMainTaskLabel } from "@/modules/tasks/kpi-main-task";
import { normalizeTimeZone } from "@/modules/tasks/kpi-recurrence";
import { copySubKpiItemsToSegments } from "@/modules/tasks/kpi-subkpis";
import { listSubTasksPayload } from "@/modules/tasks/kpi-subtasks-rest";
import { resolveOpsPermissions } from "@/lib/ops-permissions";
import { prisma } from "@/modules/platform/db/prisma";
import { KPI_ROW_SELECT, checklistFullyComplete, snapshotIfRecurring } from "../_shared";

/**
 * POST /api/kpi-maintenance/:id/subtasks/copy
 * Copy one or more sub-tasks into other segments (admins only).
 */
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
    sourceIds?: string[];
    sourceId?: string;
    targetSegmentIds?: string[];
    keepDueDate?: boolean;
    keepAssignee?: boolean;
    keepPriority?: boolean;
  };

  const fromArray = Array.isArray(body.sourceIds)
    ? body.sourceIds.map((x) => String(x ?? "").trim()).filter(Boolean)
    : [];
  const single = String(body.sourceId ?? "").trim();
  const sourceIds = [...new Set([...fromArray, ...(single ? [single] : [])])];

  const result = copySubKpiItemsToSegments(row.subKpis, {
    sourceIds,
    targetSegmentIds: Array.isArray(body.targetSegmentIds) ? body.targetSegmentIds : [],
    keepDueDate: body.keepDueDate,
    keepAssignee: body.keepAssignee,
    keepPriority: body.keepPriority,
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

  return NextResponse.json({
    ...listSubTasksPayload(row.id, result.json),
    copiedCount: result.copiedCount,
  });
}
