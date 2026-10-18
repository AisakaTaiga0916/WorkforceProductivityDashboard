import { isElevatedUserRole } from "@/modules/platform/auth";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import {
  applyPhaseDelayNotifications,
  isItProjectEnvelope,
  isItProjectPhaseDelayed,
  parseItProjectSubKpis,
  phaseDelayNotifyAssignees,
  resolvePhaseEffectiveTargetDate,
} from "@/modules/tasks/it-project-subkpis";
import { getTaskTargetDueDate } from "@/modules/tasks/kpi-subkpis";
import { normalizeTimeZone } from "@/modules/tasks/kpi-recurrence";
import { resolveOpsPermissions } from "@/lib/ops-permissions";
import { prisma } from "@/modules/platform/db/prisma";

type DelayAlert = {
  kpiMaintenanceId: string;
  kpiTitle: string;
  phaseId: string;
  phaseName: string;
  targetDate: string;
  href: string;
  newlyNotified: boolean;
};

/**
 * GET /api/kpi-maintenance/phase-delay-alerts
 * Delayed Timeline Tracker phases for the current assignee (notify at most once per phase per day).
 * Admin / SuperAdmin without an operator agent row still see delayed phases (monitor view).
 */
export async function GET(req: Request) {
  const { session, unauthorized } = await requireRole(["Admin", "Personnel", "SuperAdmin"]);
  if (unauthorized || !session) return unauthorized;
  const perms = await resolveOpsPermissions(session);
  const agentId = perms.operator?.id ?? null;
  const isMonitor =
    session.user.role === "Admin" || isElevatedUserRole(session.user.role);
  if (!agentId && !isMonitor) {
    return NextResponse.json({ delayedPhases: [], newlyNotified: [] });
  }

  const url = new URL(req.url);
  const timeZone = normalizeTimeZone(url.searchParams.get("tz") ?? undefined);
  const nowMs = Date.now();

  const rows = await prisma.kpiMaintenance.findMany({
    select: {
      id: true,
      title: true,
      mainTask: true,
      subKpis: true,
      assignedAgentId: true,
      updatedAt: true,
    },
    take: 500,
    orderBy: { updatedAt: "desc" },
  });

  const delayedPhases: DelayAlert[] = [];
  const newlyNotified: DelayAlert[] = [];

  for (const row of rows) {
    if (!isItProjectEnvelope(row.subKpis)) continue;
    const mainDue = getTaskTargetDueDate(row.subKpis);
    const dataBefore = parseItProjectSubKpis(row.subKpis);
    const relevant = dataBefore.phases.some((phase) => {
      if (!isItProjectPhaseDelayed(phase, timeZone, nowMs, mainDue)) return false;
      if (!agentId) return isMonitor;
      return phaseDelayNotifyAssignees(phase, row.assignedAgentId).includes(agentId);
    });
    if (!relevant && !(agentId && row.assignedAgentId === agentId) && !(!agentId && isMonitor)) {
      continue;
    }

    const delayPass = applyPhaseDelayNotifications(row.subKpis, {
      timeZone,
      nowMs,
      cardAssignedAgentId: row.assignedAgentId,
      mainProjectDueDate: mainDue,
    });
    if (delayPass.notifications.length > 0) {
      await prisma.kpiMaintenance.update({
        where: { id: row.id },
        data: { subKpis: delayPass.json },
      });
    }

    const data = parseItProjectSubKpis(delayPass.json);
    for (const phase of data.phases) {
      if (!isItProjectPhaseDelayed(phase, timeZone, nowMs, mainDue)) continue;
      const assignees = phaseDelayNotifyAssignees(phase, row.assignedAgentId);
      if (agentId && !assignees.includes(agentId)) continue;
      if (!agentId && !isMonitor) continue;
      const target = resolvePhaseEffectiveTargetDate(phase, mainDue);
      if (!target) continue;
      const entry: DelayAlert = {
        kpiMaintenanceId: row.id,
        kpiTitle: (row.mainTask?.trim() || row.title).trim(),
        phaseId: phase.id,
        phaseName: phase.name,
        targetDate: target,
        href: `/agent/tasks?task=${encodeURIComponent(row.id)}`,
        newlyNotified: Boolean(
          agentId &&
            delayPass.notifications.some(
              (n) => n.phaseId === phase.id && n.agentIds.includes(agentId),
            ),
        ),
      };
      delayedPhases.push(entry);
      if (entry.newlyNotified) newlyNotified.push(entry);
    }
  }

  return NextResponse.json({ delayedPhases, newlyNotified });
}
