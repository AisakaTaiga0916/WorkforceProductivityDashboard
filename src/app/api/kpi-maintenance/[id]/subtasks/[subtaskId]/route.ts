import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { moduleDisabledResponse } from "@/modules/platform/settings/system-modules-db";
import { isItProjectImplementationPillar } from "@/modules/tasks/it-task-pillar-titles";
import { kpiMainTaskLabel } from "@/modules/tasks/kpi-main-task";
import { normalizeTimeZone } from "@/modules/tasks/kpi-recurrence";
import {
  moveSubKpiItemOnBoard,
  removeSubKpiItem,
  updateSubKpiItem,
  type SubKpiBoardColumn,
} from "@/modules/tasks/kpi-subkpis";
import { listSubTasksPayload } from "@/modules/tasks/kpi-subtasks-rest";
import { resolveOpsPermissions } from "@/lib/ops-permissions";
import { prisma } from "@/modules/platform/db/prisma";
import { KPI_ROW_SELECT, type KpiRow, checklistFullyComplete, snapshotIfRecurring } from "../_shared";

async function loadAdminAndRow(id: string) {
  const { session, unauthorized } = await requireRole(["Admin", "Personnel"]);
  if (unauthorized || !session) return { errorResponse: unauthorized as NextResponse };
  const perms = await resolveOpsPermissions(session);
  if (!perms.isAdminRole) {
    return { errorResponse: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  const row = await prisma.kpiMaintenance.findUnique({ where: { id }, select: KPI_ROW_SELECT });
  if (!row) {
    return { errorResponse: NextResponse.json({ error: "Task not found." }, { status: 404 }) };
  }
  if (isItProjectImplementationPillar(row.title)) {
    return {
      errorResponse: NextResponse.json(
        { error: "Use task management to edit IT Project Implementation checklists." },
        { status: 400 },
      ),
    };
  }
  return { row };
}

async function persistSubKpis(row: KpiRow, updatedJson: unknown, tz: string) {
  const label = kpiMainTaskLabel(row);
  const prevComplete = checklistFullyComplete(row.subKpis, label);
  const nextComplete = checklistFullyComplete(updatedJson, label);
  let lastFullCompletionAt: Date | null | undefined;
  if (!prevComplete && nextComplete) lastFullCompletionAt = new Date();
  else if (prevComplete && !nextComplete) lastFullCompletionAt = null;

  await prisma.kpiMaintenance.update({
    where: { id: row.id },
    data: {
      subKpis: updatedJson as never,
      ...(nextComplete ? { rolledOverIncomplete: false } : {}),
      ...(lastFullCompletionAt !== undefined ? { lastFullCompletionAt } : {}),
    },
  });
  await snapshotIfRecurring(row, updatedJson, tz);
}

function parseBoardColumn(value: unknown): SubKpiBoardColumn | null {
  if (value === "todo" || value === "progress" || value === "done") return value;
  return null;
}

/** PUT /api/kpi-maintenance/:id/subtasks/:subtaskId — edit or move a sub-task (admins only). */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string; subtaskId: string }> }) {
  const moduleOff = await moduleDisabledResponse("tasks");
  if (moduleOff) return moduleOff;
  const { id, subtaskId } = await ctx.params;
  const { row, errorResponse } = await loadAdminAndRow(id);
  if (!row) return errorResponse;
  const tz = normalizeTimeZone(new URL(req.url).searchParams.get("tz"));

  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    description?: string | null;
    remarks?: string | null;
    dueDate?: string | null;
    dueDateRollsWithCycle?: boolean | null;
    priority?: string | null;
    done?: boolean;
    /** Move to this segment (use "__unsegmented__" for the General board). */
    segmentId?: string | null;
    /** Kanban column: todo | progress | done */
    boardColumn?: string | null;
    /** Optional insert index within the target segment. */
    index?: number | null;
  };

  const boardColumn = parseBoardColumn(body.boardColumn);
  const wantsMove =
    body.segmentId !== undefined || body.boardColumn !== undefined || body.index !== undefined;

  if (wantsMove) {
    const { normalizeSubKpis, UNSEGMENTED_SEGMENT_ID } = await import("@/modules/tasks/kpi-subkpis");
    const n = normalizeSubKpis(row.subKpis);
    let currentSeg = UNSEGMENTED_SEGMENT_ID;
    if (n.segmented) {
      for (const seg of n.segments) {
        if (seg.items.some((it) => it.id === subtaskId)) {
          currentSeg = seg.id;
          break;
        }
      }
    }
    const targetSegmentId =
      body.segmentId === undefined || body.segmentId === null
        ? currentSeg
        : String(body.segmentId).trim() || UNSEGMENTED_SEGMENT_ID;

    const result = moveSubKpiItemOnBoard(row.subKpis, subtaskId, {
      targetSegmentId,
      boardColumn: boardColumn ?? undefined,
      index: body.index,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    await persistSubKpis(row, result.json, tz);
    return NextResponse.json(listSubTasksPayload(row.id, result.json));
  }

  if (
    body.title === undefined &&
    body.description === undefined &&
    body.remarks === undefined &&
    body.dueDate === undefined &&
    body.dueDateRollsWithCycle === undefined &&
    body.priority === undefined
  ) {
    return NextResponse.json(
      {
        error:
          "Provide title, description, remarks, dueDate, dueDateRollsWithCycle, priority, segmentId, and/or boardColumn.",
      },
      { status: 400 },
    );
  }

  const result = updateSubKpiItem(row.subKpis, subtaskId, {
    ...(body.title !== undefined ? { title: body.title } : {}),
    ...(body.description !== undefined ? { description: body.description ?? null } : {}),
    ...(body.remarks !== undefined ? { remarks: body.remarks ?? null } : {}),
    ...(body.dueDate !== undefined ? { dueDate: body.dueDate } : {}),
    ...(body.dueDateRollsWithCycle !== undefined
      ? { dueDateRollsWithCycle: body.dueDateRollsWithCycle === true }
      : {}),
    ...(body.priority !== undefined ? { projectPriority: body.priority ?? null } : {}),
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  await persistSubKpis(row, result.json, tz);
  return NextResponse.json(listSubTasksPayload(row.id, result.json));
}

/** DELETE /api/kpi-maintenance/:id/subtasks/:subtaskId — remove a sub-task (admins only). */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string; subtaskId: string }> }) {
  const moduleOff = await moduleDisabledResponse("tasks");
  if (moduleOff) return moduleOff;
  const { id, subtaskId } = await ctx.params;
  const { row, errorResponse } = await loadAdminAndRow(id);
  if (!row) return errorResponse;
  const tz = normalizeTimeZone(new URL(req.url).searchParams.get("tz"));

  const result = removeSubKpiItem(row.subKpis, subtaskId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  await persistSubKpis(row, result.json, tz);
  return NextResponse.json(listSubTasksPayload(row.id, result.json));
}
