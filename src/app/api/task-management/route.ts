import { isElevatedUserRole } from "@/lib/auth";
import { TaskStatus } from "@prisma/client/primary";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { triggerEfficiencyRecomputeBackground } from "@/lib/efficiency/trigger-efficiency-recompute";
import {
  normalizeDelayPenaltyFrequency,
  penaltyAccrualUnits,
  type DelayPenaltyFrequency,
} from "@/lib/delay-penalty-frequency";
import { prisma } from "@/lib/prisma";
import { resolveOpsPermissions } from "@/lib/ops-permissions";
import { isTaskCompletionVerificationEnabled } from "@/lib/task-verification-settings-db";
import { DateTime } from "luxon";
import { DEFAULT_TIME_ZONE } from "@/lib/kpi-recurrence";

const statusSet = new Set(Object.values(TaskStatus));

function taskItemAccruedPenalty(args: {
  dueAt: Date | null;
  completedAt: Date | null;
  status: TaskStatus;
  delayPenaltyAmount: number | null;
  delayPenaltyFrequency?: DelayPenaltyFrequency | null;
  now?: Date;
}): number {
  const rate = args.delayPenaltyAmount ?? 0;
  if (rate <= 0 || !args.dueAt) return 0;
  const zone = DEFAULT_TIME_ZONE;
  const dueDay = DateTime.fromJSDate(args.dueAt, { zone }).startOf("day");
  const endSource =
    args.completedAt ??
    (args.status === "DONE" ? args.completedAt : null) ??
    args.now ??
    new Date();
  const endDay = DateTime.fromJSDate(endSource, { zone }).startOf("day");
  if (!dueDay.isValid || !endDay.isValid) return 0;
  const delayStart = dueDay.plus({ days: 1 });
  if (endDay < delayStart) return 0;
  const days = Math.floor(endDay.diff(delayStart, "days").days) + 1;
  const units = penaltyAccrualUnits(days, normalizeDelayPenaltyFrequency(args.delayPenaltyFrequency));
  return Math.max(0, Math.round(rate * units));
}

export async function GET() {
  const { session, unauthorized } = await requireRole(["Admin", "Personnel"]);
  if (unauthorized || !session) return unauthorized;
  const perms = await resolveOpsPermissions(session);
  const role = session.user.role;

  const where =
    role === "Admin" || isElevatedUserRole(role)
      ? {}
      : perms.canAssignWork
        ? {}
        : { assignedAgentId: perms.operator?.id ?? "__none__" };
  const rows = await prisma.taskItem.findMany({
    where,
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    include: { assignedAgent: { select: { id: true, name: true, team: { select: { name: true } } } } },
  });
  return NextResponse.json({ rows, canAssignWork: perms.canAssignWork });
}

export async function POST(req: Request) {
  const { session, unauthorized } = await requireRole(["Admin", "Personnel"]);
  if (unauthorized || !session) return unauthorized;
  const perms = await resolveOpsPermissions(session);
  if (!perms.canAssignWork) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = (await req.json()) as {
    title?: string;
    description?: string;
    assignedAgentId?: string;
    dueAt?: string;
    priority?: string;
    delayPenaltyAmount?: number | null;
    delayPenaltyFrequency?: string | null;
  };
  const title = body.title?.trim() ?? "";
  if (!title || !body.assignedAgentId) {
    return NextResponse.json({ error: "title and assignedAgentId are required." }, { status: 400 });
  }
  const assignee = await prisma.agent.findUnique({ where: { id: body.assignedAgentId }, select: { id: true } });
  if (!assignee) {
    return NextResponse.json({ error: "Assignee not found." }, { status: 404 });
  }

  const dueAt = body.dueAt ? new Date(body.dueAt) : null;
  const delayPenaltyAmount =
    typeof body.delayPenaltyAmount === "number" && Number.isFinite(body.delayPenaltyAmount)
      ? Math.max(0, Math.round(body.delayPenaltyAmount))
      : null;
  const delayPenaltyFrequency = normalizeDelayPenaltyFrequency(body.delayPenaltyFrequency);
  const created = await prisma.taskItem.create({
    data: {
      title,
      description: body.description?.trim() || null,
      assignedAgentId: assignee.id,
      dueAt: dueAt && !Number.isNaN(dueAt.getTime()) ? dueAt : null,
      priority: body.priority?.trim() || null,
      delayPenaltyAmount,
      delayPenaltyFrequency,
      createdBy: session.user.email ?? session.user.name ?? "unknown",
      createdByRole: session.user.role,
    },
  });
  await prisma.taskActivity.create({
    data: {
      taskId: created.id,
      author: session.user.email ?? session.user.name ?? "unknown",
      action: "Task created",
      detail: `Assigned to ${body.assignedAgentId}`,
    },
  });
  return NextResponse.json(created, { status: 201 });
}

export async function PATCH(req: Request) {
  const { session, unauthorized } = await requireRole(["Admin", "Personnel"]);
  if (unauthorized || !session) return unauthorized;
  const perms = await resolveOpsPermissions(session);

  const body = (await req.json()) as {
    id?: string;
    status?: string;
    lifecycle?: "start" | "end" | "verify" | "reject";
    comment?: string;
    dueAt?: string | null;
    delayPenaltyAmount?: number | null;
    delayPenaltyFrequency?: string | null;
  };
  const id = body.id?.trim() ?? "";
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  const task = await prisma.taskItem.findUnique({
    where: { id },
    select: {
      id: true,
      assignedAgentId: true,
      status: true,
      startedAt: true,
      completedAt: true,
      dueAt: true,
      delayPenaltyAmount: true,
      delayPenaltyFrequency: true,
      createdBy: true,
    },
  });
  if (!task) return NextResponse.json({ error: "Task not found." }, { status: 404 });
  const isAssignee = !!perms.operator && perms.operator.id === task.assignedAgentId;

  if (body.lifecycle === "verify" || body.lifecycle === "reject") {
    if (task.status !== "PENDING_VERIFICATION") {
      return NextResponse.json({ error: "Task is not awaiting verification." }, { status: 400 });
    }
    const { canVerifyTaskCompletion } = await import("@/lib/task-completion-verification-access");
    const mayVerify = await canVerifyTaskCompletion(
      {
        assignedAgentId: task.assignedAgentId,
        completionVerificationStatus: "PENDING_VERIFICATION",
      },
      {
        operatorAgentId: perms.operator?.id ?? null,
        operatorEmail: session.user.email ?? null,
        operatorName: session.user.name ?? null,
        role: session.user.role,
      },
    );
    if (!mayVerify) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const now = new Date();
    if (body.lifecycle === "verify") {
      const accrued = taskItemAccruedPenalty({
        dueAt: task.dueAt,
        completedAt: now,
        status: "DONE",
        delayPenaltyAmount: task.delayPenaltyAmount,
        delayPenaltyFrequency: task.delayPenaltyFrequency,
        now,
      });
      const updated = await prisma.taskItem.update({
        where: { id },
        data: {
          completedAt: now,
          status: "DONE",
          delayPenaltyAccrued: accrued,
        },
      });
      await prisma.taskActivity.create({
        data: {
          taskId: id,
          author: session.user.email ?? session.user.name ?? "unknown",
          action: "Task completion verified",
          detail: accrued > 0 ? `Verified with ${accrued} delay penalty pts` : now.toISOString(),
        },
      });
      triggerEfficiencyRecomputeBackground();
      return NextResponse.json(updated);
    }
    const comment = typeof body.comment === "string" ? body.comment.trim() : "";
    if (!comment) {
      return NextResponse.json(
        { error: "A comment is required when rejecting verification." },
        { status: 400 },
      );
    }
    const updated = await prisma.taskItem.update({
      where: { id },
      data: { status: "CURRENT", completedAt: null },
    });
    await prisma.taskActivity.create({
      data: {
        taskId: id,
        author: session.user.email ?? session.user.name ?? "unknown",
        action: "Task completion rejected",
        detail: comment,
      },
    });
    return NextResponse.json(updated);
  }

  /** SuperAdmin/Admin can update schedule/penalty; assignees use lifecycle/status. */
  const canManage = session.user.role === "Admin" || isElevatedUserRole(session.user.role) || perms.canAssignWork;
  if (
    body.dueAt !== undefined ||
    body.delayPenaltyAmount !== undefined ||
    body.delayPenaltyFrequency !== undefined
  ) {
    if (!canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const nextDueAt =
      body.dueAt === undefined
        ? task.dueAt
        : body.dueAt == null || String(body.dueAt).trim() === ""
          ? null
          : (() => {
              const d = new Date(body.dueAt);
              return Number.isNaN(d.getTime()) ? task.dueAt : d;
            })();
    const nextAmount =
      body.delayPenaltyAmount === undefined
        ? task.delayPenaltyAmount
        : typeof body.delayPenaltyAmount === "number" && Number.isFinite(body.delayPenaltyAmount)
          ? Math.max(0, Math.round(body.delayPenaltyAmount))
          : null;
    const nextFrequency =
      body.delayPenaltyFrequency === undefined
        ? task.delayPenaltyFrequency
        : normalizeDelayPenaltyFrequency(body.delayPenaltyFrequency);
    const accrued = taskItemAccruedPenalty({
      dueAt: nextDueAt,
      completedAt: task.completedAt,
      status: task.status,
      delayPenaltyAmount: nextAmount,
      delayPenaltyFrequency: nextFrequency,
    });
    const updated = await prisma.taskItem.update({
      where: { id },
      data: {
        dueAt: nextDueAt,
        delayPenaltyAmount: nextAmount,
        delayPenaltyFrequency: nextFrequency,
        delayPenaltyAccrued: accrued,
      },
    });
    triggerEfficiencyRecomputeBackground();
    return NextResponse.json(updated);
  }

  if (session.user.role === "Admin" || isElevatedUserRole(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isAssignee) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (body.lifecycle === "start" || body.lifecycle === "end") {
    const now = new Date();
    if (body.lifecycle === "start") {
      if (task.startedAt || task.completedAt || task.status === "DONE") {
        return NextResponse.json({ error: "Task already started or completed." }, { status: 400 });
      }
      const updated = await prisma.taskItem.update({
        where: { id },
        data: { startedAt: now, status: "CURRENT" },
      });
      await prisma.taskActivity.create({
        data: {
          taskId: id,
          author: session.user.email ?? session.user.name ?? "unknown",
          action: "Task started",
          detail: now.toISOString(),
        },
      });
      return NextResponse.json(updated);
    }

    if (!task.startedAt && !task.completedAt) {
      return NextResponse.json({ error: "Start the task before ending it." }, { status: 400 });
    }
    if (task.completedAt || task.status === "DONE" || task.status === "PENDING_VERIFICATION") {
      return NextResponse.json({ error: "Task already completed or awaiting verification." }, { status: 400 });
    }
    const verificationEnabled = await isTaskCompletionVerificationEnabled();
    if (!verificationEnabled) {
      const accrued = taskItemAccruedPenalty({
        dueAt: task.dueAt,
        completedAt: now,
        status: "DONE",
        delayPenaltyAmount: task.delayPenaltyAmount,
        delayPenaltyFrequency: task.delayPenaltyFrequency,
        now,
      });
      const updated = await prisma.taskItem.update({
        where: { id },
        data: {
          status: "DONE",
          completedAt: now,
          delayPenaltyAccrued: accrued,
          ...(task.startedAt ? {} : { startedAt: now }),
        },
      });
      await prisma.taskActivity.create({
        data: {
          taskId: id,
          author: session.user.email ?? session.user.name ?? "unknown",
          action: "Task completed",
          detail: now.toISOString(),
        },
      });
      return NextResponse.json(updated);
    }
    const updated = await prisma.taskItem.update({
      where: { id },
      data: {
        status: "PENDING_VERIFICATION",
        ...(task.startedAt ? {} : { startedAt: now }),
      },
    });
    await prisma.taskActivity.create({
      data: {
        taskId: id,
        author: session.user.email ?? session.user.name ?? "unknown",
        action: "Submitted for verification",
        detail: now.toISOString(),
      },
    });
    return NextResponse.json(updated);
  }

  const status = body.status?.toUpperCase() as TaskStatus;
  if (!status || !statusSet.has(status)) {
    return NextResponse.json({ error: "id and valid status (or lifecycle) are required." }, { status: 400 });
  }

  const verificationEnabled = await isTaskCompletionVerificationEnabled();
  // Assignees cannot skip verification by setting DONE directly (when verification is on).
  const effectiveStatus: TaskStatus =
    status === "DONE" && verificationEnabled ? "PENDING_VERIFICATION" : status;

  const data: {
    status: TaskStatus;
    completedAt?: Date | null;
    startedAt?: Date;
    delayPenaltyAccrued?: number;
  } = { status: effectiveStatus };
  if (effectiveStatus === "PENDING_VERIFICATION") {
    const now = new Date();
    data.completedAt = null;
    if (!task.startedAt) data.startedAt = now;
  } else if (effectiveStatus === "DONE") {
    const now = new Date();
    data.completedAt = now;
    if (!task.startedAt) data.startedAt = now;
    data.delayPenaltyAccrued = taskItemAccruedPenalty({
      dueAt: task.dueAt,
      completedAt: now,
      status: "DONE",
      delayPenaltyAmount: task.delayPenaltyAmount,
      delayPenaltyFrequency: task.delayPenaltyFrequency,
      now,
    });
  } else if (task.status === "DONE" || task.status === "PENDING_VERIFICATION") {
    data.completedAt = null;
  }

  const updated = await prisma.taskItem.update({ where: { id }, data });
  if (task.status !== effectiveStatus) {
    await prisma.taskActivity.create({
      data: {
        taskId: id,
        author: session.user.email ?? session.user.name ?? "unknown",
        action:
          effectiveStatus === "PENDING_VERIFICATION"
            ? "Submitted for verification"
            : effectiveStatus === "DONE"
              ? "Task completed"
              : "Status updated",
        detail: `${task.status} -> ${effectiveStatus}`,
      },
    });
  }
  triggerEfficiencyRecomputeBackground();
  return NextResponse.json(updated);
}
