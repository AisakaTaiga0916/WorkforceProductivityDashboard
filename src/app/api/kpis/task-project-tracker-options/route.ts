import { NextResponse } from "next/server";
import { DateTime } from "luxon";
import { requireRole } from "@/lib/access";
import { sortByCompanyOrder } from "@/modules/platform/companies/company-directory";
import { resolveViewerCompanyId } from "@/modules/platform/scope/company-access";
import {
  itProjectStatusProgress,
  normalizeItProjectPriority,
  normalizeItProjectStatus,
  parseItProjectSubKpis,
} from "@/modules/tasks/it-project-subkpis";
import { collectAllSubKpiItems, getTaskPriority, normalizeSubKpis, type SubKpiItem } from "@/modules/tasks/kpi-subkpis";
import { getPeriodStartInclusive } from "@/modules/tasks/kpi-period-window";
import {
  DEFAULT_TIME_ZONE,
  getPeriodEndExclusiveFromCycleStart,
  isKpiMetricsWorkingDay,
  type KpiFrequencyCode,
} from "@/modules/tasks/kpi-recurrence";
import { getTaskScheduleSettings } from "@/modules/platform/settings/task-schedule-settings-db";
import { workingDaysForCompany } from "@/modules/platform/settings/task-schedule-settings";
import { IT_PROJECT_IMPLEMENTATION_TITLE } from "@/modules/tasks/it-task-pillar-titles";
import { prisma } from "@/modules/platform/db/prisma";
import { loadEffectiveCompaniesByPortalEmail } from "@/modules/platform/scope/staff-company-scope";
import { isStaffPortalRole } from "@/lib/staff-role";
import { TaskStatus } from "@prisma/client/primary";

const TASK_ITEM_PREFIX = "TSK";

function taskPrefixForTitle(title: string) {
  if (title === IT_PROJECT_IMPLEMENTATION_TITLE) return "ITP";
  const words = title
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const prefix = words.length > 1 ? words.map((word) => word[0]).join("") : words[0]?.slice(0, 3);
  return (prefix || "TSK").toUpperCase().slice(0, 4);
}

function nonItTaskCompletion(item: SubKpiItem) {
  if (item.done) return 100;
  if (item.assignedAgentId) return 25;
  return 0;
}

type TrackerPriority = "High" | "Medium" | "Low";

type TaskProjectTrackerRow = {
  id: string;
  rowType: "task" | "project";
  recordId: string;
  subTaskId: string | null;
  taskId: string;
  projectName: string;
  companyId: string | null;
  companyName: string;
  taskDescription: string;
  assigneeName: string | null;
  priority: TrackerPriority;
  status: string;
  startDate: string | null;
  dueDate: string | null;
  completion: number;
  hours: number | null;
  phaseName: string;
};

function highestPriority(items: SubKpiItem[]): TrackerPriority {
  if (items.some((item) => item.projectPriority === "High")) return "High";
  if (items.some((item) => item.projectPriority === "Medium")) return "Medium";
  if (items.some((item) => item.projectPriority === "Low")) return "Low";
  return "Medium";
}

function assigneeNamesForItems(
  mainAssignee: { id: string; name: string } | null | undefined,
  items: SubKpiItem[],
  agentById: Map<string, { id: string; name: string }>,
) {
  const names = new Map<string, string>();
  if (mainAssignee?.id && mainAssignee.name.trim()) {
    names.set(mainAssignee.id, mainAssignee.name.trim());
  }
  for (const item of items) {
    const subAssigneeId = item.assignedAgentId?.trim();
    const subAssigneeName = item.assignedAgentName?.trim() || (subAssigneeId ? agentById.get(subAssigneeId)?.name.trim() : "");
    if (subAssigneeId && subAssigneeName) {
      names.set(subAssigneeId, subAssigneeName);
    } else if (subAssigneeName) {
      names.set(subAssigneeName.toLowerCase(), subAssigneeName);
    }
  }
  return names.size > 0 ? [...names.values()].join(", ") : null;
}

type TrackerTaskRow = {
  frequency: KpiFrequencyCode;
  isRecurring: boolean;
  nonRecurringStartAt: Date | null;
  nonRecurringEndAt: Date | null;
  recurrenceWeekday: number | null;
  recurrenceMonthDay: number | null;
  periodCycleStartAt: Date | null;
  /** Resolved per-company working days (1=Mon…7=Sun). */
  workingDays?: readonly number[] | null;
};

function ymdInZone(date: Date | null | undefined, timeZone = DEFAULT_TIME_ZONE) {
  if (!date) return null;
  const dt = DateTime.fromJSDate(date, { zone: timeZone });
  return dt.isValid ? dt.toISODate() : null;
}

function lastWorkingDayOfMonth(
  date: Date,
  timeZone = DEFAULT_TIME_ZONE,
  workingDays?: readonly number[] | null,
) {
  let day = DateTime.fromJSDate(date, { zone: timeZone }).endOf("month").startOf("day");
  for (let i = 0; i < 7 && !isKpiMetricsWorkingDay(day, workingDays); i += 1) {
    day = day.minus({ days: 1 });
  }
  return day.isValid ? day.toISODate() : null;
}

function cadenceWindow(row: TrackerTaskRow, now: Date, timeZone = DEFAULT_TIME_ZONE) {
  if (row.isRecurring === false) {
    return {
      startDate: ymdInZone(row.nonRecurringStartAt, timeZone),
      dueDate: ymdInZone(row.nonRecurringEndAt, timeZone),
    };
  }

  const start =
    row.periodCycleStartAt ??
    getPeriodStartInclusive(
      row.frequency,
      row.recurrenceWeekday,
      row.recurrenceMonthDay,
      now,
      timeZone,
      row.workingDays,
    );
  const endExclusive = getPeriodEndExclusiveFromCycleStart(
    start,
    row.frequency,
    row.recurrenceWeekday,
    row.recurrenceMonthDay,
    timeZone,
    row.workingDays,
  );
  const due = DateTime.fromJSDate(endExclusive, { zone: timeZone }).minus({ days: 1 });

  if (row.frequency === "MONTHLY") {
    const lastWorkingDay = lastWorkingDayOfMonth(start, timeZone, row.workingDays);
    return {
      startDate: lastWorkingDay,
      dueDate: lastWorkingDay,
    };
  }

  return {
    startDate: ymdInZone(start, timeZone),
    dueDate: due.isValid ? due.toISODate() : null,
  };
}

function workdayStartAt8(startDate: string | null | undefined, now: Date, timeZone = DEFAULT_TIME_ZONE) {
  const day = startDate ?? DateTime.fromJSDate(now, { zone: timeZone }).toISODate();
  const dt = day ? DateTime.fromISO(day, { zone: timeZone }).set({ hour: 8, minute: 0, second: 0, millisecond: 0 }) : null;
  return dt?.isValid ? dt : DateTime.fromJSDate(now, { zone: timeZone }).set({ hour: 8, minute: 0, second: 0, millisecond: 0 });
}

function completionHours(args: {
  startDate: string | null | undefined;
  completion: number;
  completedAt?: Date | null;
  fallbackUpdatedAt: Date;
  now: Date;
  timeZone?: string;
}) {
  if (args.completion < 100) return null;
  const timeZone = args.timeZone ?? DEFAULT_TIME_ZONE;
  const start = workdayStartAt8(args.startDate, args.now, timeZone);
  const endSource = args.completedAt ?? args.fallbackUpdatedAt;
  const end = DateTime.fromJSDate(endSource, { zone: timeZone });
  if (!end.isValid || end.toMillis() <= start.toMillis()) return 0;
  return Math.round(((end.toMillis() - start.toMillis()) / 3_600_000) * 10) / 10;
}

export async function GET() {
  const { session, unauthorized } = await requireRole(["SuperAdmin", "HighAdmin", "Admin", "Personnel"]);
  if (unauthorized) return unauthorized;
  const restrictToAssignedCompany =
    session.user.role === "Admin" || session.user.role === "Personnel";
  const scopedCompanyId = restrictToAssignedCompany ? await resolveViewerCompanyId(session) : null;

  const [taskRows, taskItemRows, staffCompanyRows, agents] = await Promise.all([
    prisma.kpiMaintenance.findMany({
      select: {
        id: true,
        title: true,
        frequency: true,
        isRecurring: true,
        nonRecurringStartAt: true,
        nonRecurringEndAt: true,
        recurrenceWeekday: true,
        recurrenceMonthDay: true,
        periodCycleStartAt: true,
        lastFullCompletionAt: true,
        updatedAt: true,
        itProjectName: true,
        subKpis: true,
        scopedCompanyTeamId: true,
        assignedAgent: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.taskItem.findMany({
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        createdAt: true,
        dueAt: true,
        assignedAgent: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.portalAccount.findMany({
      where: { accountStatus: "ACTIVE" },
      select: {
        email: true,
        role: true,
        mergedSourceUserId: true,
        staffDesignatedCompany: { select: { id: true, name: true } },
      },
    }),
    prisma.agent.findMany({
      select: { id: true, name: true, email: true },
    }),
  ]);
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  // Per-company Task Schedule Config masks for tracker cadence windows.
  const scheduleSettings = await getTaskScheduleSettings().catch(() => null);
  const taskRowsWithSchedule = taskRows.map((row) => ({
    ...row,
    workingDays: scheduleSettings
      ? workingDaysForCompany(scheduleSettings, row.scopedCompanyTeamId)
      : null,
  }));
  // Default-company grouping (memberships, HRIS fallback).
  const staffPortalRows = staffCompanyRows.filter((row) => isStaffPortalRole(row.role));
  const effectiveCompanyByEmail = await loadEffectiveCompaniesByPortalEmail(staffPortalRows);
  const companiesById = new Map<string, { id: string; name: string }>();
  for (const company of effectiveCompanyByEmail.values()) {
    if (!company?.id) continue;
    companiesById.set(company.id, { id: company.id, name: company.name });
  }
  const companies = (await sortByCompanyOrder(Array.from(companiesById.values()))).filter((company) =>
    restrictToAssignedCompany ? company.id === scopedCompanyId : true,
  );

  const assigneeEmails = [
    ...taskRows.map((row) => row.assignedAgent?.email?.trim().toLowerCase()),
    ...taskItemRows.map((row) => row.assignedAgent?.email?.trim().toLowerCase()),
    ...agents.map((agent) => agent.email.trim().toLowerCase()),
  ]
    .filter((email): email is string => Boolean(email));
  const portalCompanies = assigneeEmails.length
    ? await prisma.portalAccount.findMany({
        where: { email: { in: assigneeEmails } },
        select: {
          email: true,
          mergedSourceUserId: true,
          staffDesignatedCompany: { select: { id: true, name: true } },
        },
      })
    : [];
  const companyByEmail = await loadEffectiveCompaniesByPortalEmail(portalCompanies);

  const prefixCounts = new Map<string, number>();
  const now = new Date();

  function ymdFromDate(date: Date | null | undefined) {
    if (!date) return null;
    try { return DateTime.fromJSDate(date).toISODate(); } catch { return null; }
  }

  function taskItemStatus(status: TaskStatus): string {
    switch (status) {
      case "DONE": return "Done";
      case "DELAYED": return "Delayed";
      default: return "On Going";
    }
  }

  function taskItemCompletion(status: TaskStatus): number {
    switch (status) {
      case "DONE": return 100;
      case "DELAYED": return 25;
      default: return 50;
    }
  }

  function taskItemPriority(priority: string | null): TrackerPriority {
    if (priority === "High" || priority === "Low") return priority;
    return "Medium";
  }

  const taskItemRowsMapped: TaskProjectTrackerRow[] = taskItemRows.map((item) => {
    const assigneeEmail = item.assignedAgent?.email?.trim().toLowerCase();
    const company = assigneeEmail ? companyByEmail.get(assigneeEmail) : null;
    const nextIndex = (prefixCounts.get(TASK_ITEM_PREFIX) ?? 0) + 1;
    prefixCounts.set(TASK_ITEM_PREFIX, nextIndex);
    const status = taskItemStatus(item.status as TaskStatus);
    return {
      id: `taskitem:${item.id}`,
      rowType: "task" as const,
      recordId: item.id,
      subTaskId: null,
      taskId: `${TASK_ITEM_PREFIX}-${String(nextIndex).padStart(3, "0")}`,
      projectName: item.title,
      companyId: company?.id ?? null,
      companyName: company?.name ?? "Unassigned company",
      taskDescription: item.description ?? item.title,
      assigneeName: item.assignedAgent?.name ?? null,
      priority: taskItemPriority(item.priority),
      status,
      startDate: ymdFromDate(item.createdAt),
      dueDate: ymdFromDate(item.dueAt),
      completion: taskItemCompletion(item.status as TaskStatus),
      hours: null,
      phaseName: item.title,
    };
  });

  const tasks = [
    ...taskItemRowsMapped,
    ...taskRowsWithSchedule.flatMap<TaskProjectTrackerRow>((row) => {
    const isItProject = row.title === IT_PROJECT_IMPLEMENTATION_TITLE;
    const projectName = isItProject ? row.itProjectName?.trim() || "IT Project Implementation" : row.title.trim();
    const prefix = taskPrefixForTitle(row.title);
    const rowWindow = cadenceWindow(row, now);
    const data = isItProject
      ? parseItProjectSubKpis(row.subKpis).phases.map((phase) => ({ name: phase.name, items: phase.items }))
      : [];

    if (!isItProject) {
      const items = collectAllSubKpiItems(normalizeSubKpis(row.subKpis)).filter((item) => item.title.trim());
      if (items.length === 0) return [];

      const firstSubAssigneeId = items.find((item) => item.assignedAgentId)?.assignedAgentId ?? null;
      const assignee = row.assignedAgent ?? (firstSubAssigneeId ? agentById.get(firstSubAssigneeId) : null);
      const assigneeEmail = assignee?.email?.trim().toLowerCase();
      const company = assigneeEmail ? companyByEmail.get(assigneeEmail) : null;
      const doneCount = items.filter((item) => item.done).length;
      const completion = Math.round((doneCount / items.length) * 100);
      const nextIndex = (prefixCounts.get(prefix) ?? 0) + 1;
      prefixCounts.set(prefix, nextIndex);
      const startDate = rowWindow.startDate;
      const priority = items.length > 1 ? getTaskPriority(row.subKpis) ?? highestPriority(items) : highestPriority(items);

      return [
        {
          id: row.id,
          rowType: "task",
          recordId: row.id,
          subTaskId: null,
          taskId: `${prefix}-${String(nextIndex).padStart(3, "0")}`,
          projectName,
          companyId: company?.id ?? null,
          companyName: company?.name ?? "Unassigned company",
          taskDescription: items.map((item) => item.title.trim()).join(", "),
          assigneeName: assigneeNamesForItems(row.assignedAgent, items, agentById),
          priority,
          status: completion === 100 ? "Done" : completion > 0 ? "On Going" : "Pending",
          startDate,
          dueDate: rowWindow.dueDate,
          completion,
          hours: completionHours({
            startDate,
            completion,
            completedAt: row.lastFullCompletionAt,
            fallbackUpdatedAt: row.updatedAt,
            now,
          }),
          phaseName: row.title,
        },
      ];
    }

    return data.flatMap((phase) =>
      phase.items.map((item) => {
        const assignee = item.assignedAgentId ? agentById.get(item.assignedAgentId) : row.assignedAgent;
        const assigneeEmail = assignee?.email?.trim().toLowerCase();
        const company = assigneeEmail ? companyByEmail.get(assigneeEmail) : null;
        const status = normalizeItProjectStatus(item.projectStatus) ?? (item.assignedAgentId ? "Pending" : "Pending");
        const completion = isItProject ? itProjectStatusProgress(item) : nonItTaskCompletion(item);
        const nextIndex = (prefixCounts.get(prefix) ?? 0) + 1;
        prefixCounts.set(prefix, nextIndex);
        const startDate = item.startDate ?? rowWindow.startDate;
        return {
          id: `${row.id}:${item.id}`,
          rowType: "project",
          recordId: row.id,
          subTaskId: item.id,
          taskId: `${prefix}-${String(nextIndex).padStart(3, "0")}`,
          projectName,
          companyId: company?.id ?? null,
          companyName: company?.name ?? "Unassigned company",
          taskDescription: item.title,
          assigneeName: assigneeNamesForItems(row.assignedAgent, [item], agentById),
          priority: normalizeItProjectPriority(item.projectPriority) ?? "Medium",
          status: isItProject ? status : item.done ? "Done" : item.assignedAgentId ? "Pending" : "Pending",
          startDate,
          dueDate: item.dueDate ?? rowWindow.dueDate,
          completion,
          hours: completionHours({
            startDate,
            completion,
            completedAt: completion >= 100 ? row.lastFullCompletionAt : null,
            fallbackUpdatedAt: row.updatedAt,
            now,
          }),
          phaseName: phase.name,
        };
      }),
    );
  }),];

  const scopedTasks = restrictToAssignedCompany ? tasks.filter((task) => task.companyId === scopedCompanyId) : tasks;
  const seenProjects = new Set<string>();
  const projects = scopedTasks.flatMap((task) => {
    const key = task.projectName.toLowerCase();
    if (seenProjects.has(key)) return [];
    seenProjects.add(key);
    return [{ name: task.projectName }];
  });

  return NextResponse.json({
    projects: projects.length > 0 ? projects : [{ name: "IT Project Implementation" }],
    companies,
    tasks: scopedTasks,
    _debug: { kpiCount: taskRows.length, taskItemCount: taskItemRows.length, taskItemMappedCount: taskItemRowsMapped.length, scopedCount: scopedTasks.length },
  });
}
