import type { KpiFrequency, Prisma } from "@prisma/client/primary";
import { prisma } from "@/modules/platform/db/prisma";
import {
  parseDepartmentTaskCsv,
  type DepartmentTaskCsvTask,
} from "@/modules/tasks/department-task-csv";
import { applySubKpiCompletionRequirements, subKpiRequirementsMet } from "@/modules/tasks/sub-kpi-completion-mode";
import {
  applyPillarOnlyTaskCreate,
  setPillarWorkMeta,
  setTaskCount,
  syncPillarDoneFromRequirements,
  wrapForPersist,
  type SubKpiItem,
} from "@/modules/tasks/kpi-subkpis";
import {
  computePeriodKey,
  normalizeTimeZone,
  type KpiFrequencyCode,
} from "@/modules/tasks/kpi-recurrence";
import { getPeriodStartInclusive } from "@/modules/tasks/kpi-period-window";
import { resolveRosterCompanyName } from "@/modules/hierarchy/hris-company-aliases";

export type DepartmentTaskImportResult = {
  created: Array<{ id: string; mainTask: string; assigneeEmail: string }>;
  skipped: Array<{ mainTask: string; reason: string }>;
  /** Soft warnings (task created, but department link / company resolve failed). */
  warnings: string[];
  membershipsAdded: number;
  errors: string[];
};

type MembershipResult =
  | { ok: true }
  | { ok: false; reason: string };

function buildSubKpisJson(task: DepartmentTaskCsvTask): Prisma.InputJsonValue {
  // Pillar-only: blank subtask_title — completion requirements live on the main task.
  if (task.subtasks.length === 0 && task.pillarRequirements) {
    let json = wrapForPersist({ segmented: false, flat: [] }) as Prisma.InputJsonValue;
    json = applyPillarOnlyTaskCreate(json, task.pillarRequirements, {
      numericalTarget: task.pillarNumericalTarget,
    });
    if (task.pillarNumericalValue != null) {
      json = setPillarWorkMeta(json, { numericalValue: task.pillarNumericalValue });
    }
    return syncPillarDoneFromRequirements(json);
  }

  const flat: SubKpiItem[] = task.subtasks.map((st) => {
    let item: SubKpiItem = {
      id: crypto.randomUUID(),
      title: st.title,
      done: false,
    };
    item = applySubKpiCompletionRequirements(item, st.requirements);
    if (st.numericalTarget != null) {
      item.numericalTarget = st.numericalTarget;
    }
    if (st.numericalValue != null) {
      item.numericalValue = st.numericalValue;
    }
    // Mark done when CSV-supplied fields already satisfy every enabled requirement
    // (e.g. numerical-only with actual >= target). Checkbox/screenshot rows stay open.
    if (subKpiRequirementsMet(item)) {
      item.done = true;
    }
    return item;
  });
  const wrapped = wrapForPersist({ segmented: false, flat });
  return setTaskCount(wrapped, flat.length);
}

async function resolveAgentIdByEmail(email: string): Promise<string | null> {
  const agent = await prisma.agent.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  return agent?.id ?? null;
}

async function resolveCompanyTeamId(company: string | null): Promise<{
  teamId: string | null;
  warning: string | null;
}> {
  if (!company?.trim()) return { teamId: null, warning: null };
  const raw = company.trim();
  const canonical = resolveRosterCompanyName(raw) ?? raw;
  const team = await prisma.team.findFirst({
    where: { name: { equals: canonical, mode: "insensitive" } },
    select: { id: true },
  });
  if (!team) {
    return {
      teamId: null,
      warning: `Company "${raw}" not found on roster (tried "${canonical}")`,
    };
  }
  return { teamId: team.id, warning: null };
}

async function ensureDepartmentMembership(args: {
  departmentName: string | null;
  agentId: string;
}): Promise<MembershipResult> {
  if (!args.departmentName?.trim()) {
    return { ok: false, reason: "No department_name on row" };
  }
  const dept = args.departmentName.trim();
  const section = await prisma.orgChartSection.findFirst({
    where: { name: { equals: dept, mode: "insensitive" } },
    select: { id: true },
  });
  if (!section) {
    return { ok: false, reason: `Department "${dept}" not found on org chart` };
  }

  const agent = await prisma.agent.findUnique({
    where: { id: args.agentId },
    select: { email: true, name: true },
  });
  if (!agent?.email) {
    return { ok: false, reason: `Agent has no email for department link` };
  }

  // Prefer org-chart node linked via merged portal email.
  const portal = await prisma.portalAccount.findFirst({
    where: { email: { equals: agent.email, mode: "insensitive" } },
    select: { mergedSourceUserId: true },
  });
  if (portal?.mergedSourceUserId == null) {
    return {
      ok: false,
      reason: `No portal/HRIS link for ${agent.email} — cannot attach to "${dept}"`,
    };
  }

  const node = await prisma.orgChartNode.findFirst({
    where: { mergedSourceUserId: portal.mergedSourceUserId.toString() },
    select: { id: true },
  });
  if (!node) {
    return {
      ok: false,
      reason: `${agent.email} is not on the org chart — cannot attach to "${dept}"`,
    };
  }

  await prisma.orgChartNodeSectionMembership.createMany({
    data: [{ nodeId: node.id, sectionId: section.id }],
    skipDuplicates: true,
  });
  // Keep legacy primary section when empty.
  await prisma.orgChartNode.updateMany({
    where: { id: node.id, sectionId: null },
    data: { sectionId: section.id },
  });
  return { ok: true };
}

export async function importDepartmentTasksFromCsv(
  content: string,
  opts: {
    timeZone?: string;
    createdBy: string;
    createdByRole: string;
  },
): Promise<DepartmentTaskImportResult> {
  const parsed = parseDepartmentTaskCsv(content);
  const result: DepartmentTaskImportResult = {
    created: [],
    skipped: [],
    warnings: [],
    membershipsAdded: 0,
    errors: [...parsed.errors],
  };
  if (parsed.tasks.length === 0) return result;

  const zone = normalizeTimeZone(opts.timeZone);
  const now = new Date();
  const createdBy = opts.createdBy.trim() || "csv-import";
  const createdByRole = opts.createdByRole.trim() || "Admin";

  for (const task of parsed.tasks) {
    const agentId = await resolveAgentIdByEmail(task.assigneeEmail);
    if (!agentId) {
      result.skipped.push({
        mainTask: task.mainTask,
        reason: `No agent found for email ${task.assigneeEmail}`,
      });
      continue;
    }

    const mainTask = task.mainTask.trim();
    const title = mainTask.replace(/\s+/g, " ").toUpperCase();

    // Duplicate is per assignee — same main task name may exist for another person.
    const duplicate = await prisma.kpiMaintenance.findFirst({
      where: {
        title,
        mainTask: { equals: mainTask, mode: "insensitive" },
        assignedAgentId: agentId,
      },
      select: { id: true },
    });
    if (duplicate) {
      result.skipped.push({
        mainTask,
        reason: `Task "${mainTask}" already exists for ${task.assigneeEmail}`,
      });
      continue;
    }

    const frequency = task.frequency as KpiFrequency;
    const isRecurring = task.isRecurring;
    let recurrenceWeekday: number | null = null;
    let recurrenceMonthDay: number | null = null;
    if (isRecurring && frequency === "WEEKLY") {
      recurrenceWeekday = 1; // Monday
    }
    if (
      isRecurring &&
      (frequency === "MONTHLY" ||
        frequency === "QUARTERLY" ||
        frequency === "SEMI_ANNUAL" ||
        frequency === "YEARLY")
    ) {
      recurrenceMonthDay = 1;
    }

    const periodCycleStartAt = isRecurring
      ? getPeriodStartInclusive(
          frequency as KpiFrequencyCode,
          recurrenceWeekday,
          recurrenceMonthDay,
          now,
          zone,
        )
      : null;
    const periodKey = isRecurring
      ? computePeriodKey(
          frequency as KpiFrequencyCode,
          recurrenceWeekday,
          recurrenceMonthDay,
          now,
          zone,
        )
      : null;

    const companyResolved = await resolveCompanyTeamId(task.company);
    if (companyResolved.warning) {
      result.warnings.push(`"${mainTask}": ${companyResolved.warning}`);
    }
    const subKpis = buildSubKpisJson(task);

    try {
      const created = await prisma.kpiMaintenance.create({
        data: {
          title,
          mainTask,
          isRecurring,
          frequency,
          subKpis,
          assignedAgentId: agentId,
          scopedCompanyTeamId: companyResolved.teamId,
          recurrenceWeekday,
          recurrenceMonthDay,
          periodCycleStartAt,
          periodKey,
          createdBy,
          createdByRole,
        },
        select: { id: true, mainTask: true },
      });

      result.created.push({
        id: created.id,
        mainTask: created.mainTask ?? mainTask,
        assigneeEmail: task.assigneeEmail,
      });

      if (task.departmentName?.trim()) {
        const membership = await ensureDepartmentMembership({
          departmentName: task.departmentName,
          agentId,
        });
        if (membership.ok) {
          result.membershipsAdded += 1;
        } else {
          result.warnings.push(
            `"${mainTask}" (${task.assigneeEmail}): ${membership.reason}`,
          );
        }
      }
    } catch (e) {
      result.errors.push(
        `Failed to create "${mainTask}": ${e instanceof Error ? e.message : "unknown error"}`,
      );
    }
  }

  return result;
}
