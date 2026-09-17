import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client/primary";
import { prisma } from "@/lib/prisma";

export type KpiActivityRow = {
  id: string;
  author: string;
  summary: string;
  detail: string | null;
  createdAt: string;
};

/** Persist a Task Board audit entry for a KPI / project card. */
export async function logKpiActivity(args: {
  kpiMaintenanceId: string;
  author: string;
  summary: string;
  detail?: string | null;
}): Promise<void> {
  const author = args.author.trim() || "User";
  const summary = args.summary.trim();
  if (!args.kpiMaintenanceId || !summary) return;
  const detail = args.detail?.trim() || null;
  const id = randomUUID().replace(/-/g, "").slice(0, 25);

  try {
    const client = prisma as unknown as {
      kpiMaintenanceActivity?: {
        create: (args: {
          data: {
            id?: string;
            kpiMaintenanceId: string;
            author: string;
            summary: string;
            detail?: string | null;
          };
        }) => Promise<unknown>;
      };
    };
    if (client.kpiMaintenanceActivity?.create) {
      await client.kpiMaintenanceActivity.create({
        data: {
          id,
          kpiMaintenanceId: args.kpiMaintenanceId,
          author,
          summary,
          detail,
        },
      });
      return;
    }
  } catch {
    // Fall through to raw SQL when the generated client is stale.
  }

  await prisma.$executeRaw`
    INSERT INTO kpi_maintenance_activities (id, kpi_maintenance_id, author, summary, detail, created_at)
    VALUES (${id}, ${args.kpiMaintenanceId}, ${author}, ${summary}, ${detail}, NOW())
  `;
}

export async function listKpiActivities(
  kpiMaintenanceId: string,
  take = 100,
): Promise<KpiActivityRow[]> {
  const limit = Math.min(Math.max(take, 1), 200);
  try {
    const client = prisma as unknown as {
      kpiMaintenanceActivity?: {
        findMany: (args: {
          where: { kpiMaintenanceId: string };
          orderBy: { createdAt: "desc" };
          take: number;
          select: {
            id: true;
            author: true;
            summary: true;
            detail: true;
            createdAt: true;
          };
        }) => Promise<
          Array<{
            id: string;
            author: string;
            summary: string;
            detail: string | null;
            createdAt: Date;
          }>
        >;
      };
    };
    if (client.kpiMaintenanceActivity?.findMany) {
      const rows = await client.kpiMaintenanceActivity.findMany({
        where: { kpiMaintenanceId },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          author: true,
          summary: true,
          detail: true,
          createdAt: true,
        },
      });
      return rows.map((r) => ({
        id: r.id,
        author: r.author,
        summary: r.summary,
        detail: r.detail,
        createdAt: r.createdAt.toISOString(),
      }));
    }
  } catch {
    // Fall through to raw SQL when the generated client is stale.
  }

  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      author: string;
      summary: string;
      detail: string | null;
      created_at: Date;
    }>
  >(
    Prisma.sql`
      SELECT id, author, summary, detail, created_at
      FROM kpi_maintenance_activities
      WHERE kpi_maintenance_id = ${kpiMaintenanceId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `,
  );

  return rows.map((r) => ({
    id: r.id,
    author: r.author,
    summary: r.summary,
    detail: r.detail,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

type PatchBodyLike = {
  assignedAgentId?: string;
  taskPriority?: string | null;
  taskDailyPenaltyAmount?: number | null;
  taskDelayPenaltyFrequency?: string | null;
  taskSchedule?: unknown;
  moveToTaskGroup?: string;
  deleteTask?: boolean;
  itProjectName?: string | null;
  itProjectPhase?: string | null;
  itProjectState?: unknown;
  subKpiWorkMeta?: { subKpiId?: string; projectPriority?: string | null; remarks?: string | null };
  subKpiProjectMeta?: { subKpiId?: string; projectPriority?: string; projectStatus?: string };
  subKpiAssignee?: { subKpiId?: string; assignedAgentId?: string | null };
  seekAssistance?: { subKpiId?: string; subKpiIds?: string[] };
  subKpiScreenshot?: { subKpiId?: string };
  subKpiScreenshotDelete?: { subKpiId?: string };
  pillarScreenshot?: unknown;
  pillarScreenshotDelete?: unknown;
  addSubKpi?: { title?: string };
  updateSubKpi?: { subKpiId?: string; title?: string };
  removeSubKpi?: { subKpiId?: string };
  subKpiSchedule?: { subKpiId?: string };
  subKpiLifecycle?: { subKpiId?: string; action?: "start" | "end" };
  moveSubKpiPhase?: { subKpiId?: string; phaseId?: string };
  phaseDueDate?: { phaseId?: string };
  structuredSubKpis?: unknown;
  markAllDone?: boolean;
  subKpiId?: string;
  done?: boolean;
  completionVerification?: { action?: string; comment?: string };
  verifierAgentId?: string | null;
};

export type InferKpiPatchAuditOptions = {
  /** Resolve a sub-task id to its display title when logging. */
  subKpiTitle?: (subKpiId: string) => string | undefined;
};

/** Infer a human-readable audit entry from a KPI PATCH body. */
export function inferKpiPatchAudit(
  body: PatchBodyLike,
  opts?: InferKpiPatchAuditOptions,
): { summary: string; detail?: string } | null {
  const labelSubKpi = (id: string | undefined | null): string | undefined => {
    const trimmed = id?.trim();
    if (!trimmed) return undefined;
    return opts?.subKpiTitle?.(trimmed)?.trim() || trimmed;
  };
  const labelSubKpis = (ids: string[] | undefined): string | undefined => {
    if (!ids?.length) return undefined;
    return ids.map((id) => labelSubKpi(id) || id).join(", ");
  };

  if (body.deleteTask === true) {
    return { summary: "Task deleted" };
  }
  if (body.completionVerification?.action === "approve") {
    return { summary: "Task completion verified" };
  }
  if (body.completionVerification?.action === "reject") {
    return {
      summary: "Task completion rejected",
      detail: body.completionVerification.comment?.trim() || undefined,
    };
  }
  if (body.completionVerification?.action === "resubmit") {
    return { summary: "Re-submitted for verification" };
  }
  if (body.verifierAgentId !== undefined) {
    return {
      summary: body.verifierAgentId ? "Verifier assigned" : "Verifier cleared",
      detail: body.verifierAgentId ? `Verifier id ${body.verifierAgentId}` : undefined,
    };
  }
  if (typeof body.moveToTaskGroup === "string") {
    return {
      summary: "Moved to task group",
      detail: body.moveToTaskGroup.trim(),
    };
  }
  if (body.assignedAgentId !== undefined) {
    return {
      summary: body.assignedAgentId ? "Assignee updated" : "Task unassigned",
      detail: body.assignedAgentId ? `Assignee id ${body.assignedAgentId}` : undefined,
    };
  }
  if (body.taskPriority !== undefined) {
    return {
      summary: "Task priority updated",
      detail: body.taskPriority ? `Set to ${body.taskPriority}` : "Priority cleared",
    };
  }
  if (body.taskDailyPenaltyAmount !== undefined) {
    return {
      summary: "Delay penalty amount updated",
      detail:
        body.taskDailyPenaltyAmount == null
          ? "Penalty cleared"
          : `Set to ${body.taskDailyPenaltyAmount}`,
    };
  }
  if (body.taskDelayPenaltyFrequency !== undefined) {
    return {
      summary: "Delay penalty frequency updated",
      detail:
        body.taskDelayPenaltyFrequency == null
          ? "Frequency cleared"
          : `Set to ${body.taskDelayPenaltyFrequency}`,
    };
  }
  if (body.taskSchedule !== undefined) {
    return { summary: "Task schedule updated" };
  }
  if (body.itProjectName !== undefined || body.itProjectPhase !== undefined) {
    return {
      summary: "Project details updated",
      detail: [body.itProjectName, body.itProjectPhase].filter(Boolean).join(" · ") || undefined,
    };
  }
  if (body.itProjectState !== undefined) {
    return { summary: "Project phases updated" };
  }
  if (body.subKpiLifecycle?.action === "start") {
    return {
      summary: "Sub-task started",
      detail: labelSubKpi(body.subKpiLifecycle.subKpiId),
    };
  }
  if (body.subKpiLifecycle?.action === "end") {
    return {
      summary: "Sub-task ended",
      detail: labelSubKpi(body.subKpiLifecycle.subKpiId),
    };
  }
  if (body.subKpiAssignee) {
    return {
      summary: body.subKpiAssignee.assignedAgentId
        ? "Sub-task assignee updated"
        : "Sub-task assignee cleared",
      detail: labelSubKpi(body.subKpiAssignee.subKpiId),
    };
  }
  if (body.seekAssistance) {
    return {
      summary: "Seek assistance requested",
      detail:
        labelSubKpi(body.seekAssistance.subKpiId) ||
        labelSubKpis(body.seekAssistance.subKpiIds),
    };
  }
  if (body.addSubKpi) {
    return {
      summary: "Sub-task added",
      detail: body.addSubKpi.title?.trim() || undefined,
    };
  }
  if (body.updateSubKpi) {
    return {
      summary: "Sub-task updated",
      detail: body.updateSubKpi.title?.trim() || labelSubKpi(body.updateSubKpi.subKpiId),
    };
  }
  if (body.removeSubKpi) {
    return {
      summary: "Sub-task removed",
      detail: labelSubKpi(body.removeSubKpi.subKpiId),
    };
  }
  if (body.subKpiProjectMeta) {
    return {
      summary: "Sub-task project metadata updated",
      detail: [
        body.subKpiProjectMeta.projectPriority,
        body.subKpiProjectMeta.projectStatus,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  }
  if (body.subKpiWorkMeta) {
    return {
      summary: "Sub-task work details updated",
      detail: labelSubKpi(body.subKpiWorkMeta.subKpiId),
    };
  }
  if (body.subKpiSchedule) {
    return {
      summary: "Sub-task schedule updated",
      detail: labelSubKpi(body.subKpiSchedule.subKpiId),
    };
  }
  if (body.moveSubKpiPhase) {
    return {
      summary: "Sub-task moved to another phase",
      detail: labelSubKpi(body.moveSubKpiPhase.subKpiId),
    };
  }
  if (body.phaseDueDate) {
    return {
      summary: "Phase due date updated",
      detail: body.phaseDueDate.phaseId,
    };
  }
  if (body.subKpiScreenshot) {
    return {
      summary: "Screenshot uploaded",
      detail: labelSubKpi(body.subKpiScreenshot.subKpiId),
    };
  }
  if (body.subKpiScreenshotDelete) {
    return {
      summary: "Screenshot removed",
      detail: labelSubKpi(body.subKpiScreenshotDelete.subKpiId),
    };
  }
  if (body.pillarScreenshot) {
    return { summary: "Pillar screenshot uploaded" };
  }
  if (body.pillarScreenshotDelete) {
    return { summary: "Pillar screenshot removed" };
  }
  if (body.structuredSubKpis !== undefined) {
    return { summary: "Checklist reorganized" };
  }
  if (typeof body.markAllDone === "boolean") {
    return {
      summary: body.markAllDone ? "All sub-tasks marked done" : "All sub-tasks reset to open",
    };
  }
  if (body.subKpiId && typeof body.done === "boolean") {
    return {
      summary: body.done ? "Sub-task marked done" : "Sub-task reopened",
      detail: labelSubKpi(body.subKpiId),
    };
  }
  return { summary: "Task updated" };
}
