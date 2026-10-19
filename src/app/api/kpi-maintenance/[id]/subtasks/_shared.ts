import { isItProjectEnvelope, itProjectAllItems, parseItProjectSubKpis } from "@/modules/tasks/it-project-subkpis";
import { timeZoneFromPeriodKey, upsertKpiPeriodSnapshot } from "@/modules/tasks/kpi-period-snapshots";
import { collectChecklistProgressItems, hasItemsInUnassignedSegment } from "@/modules/tasks/kpi-subkpis";
import { prisma } from "@/modules/platform/db/prisma";
import { getCompanyWorkingDays } from "@/modules/platform/settings/task-schedule-settings-db";
import { subKpiRequirementsMet } from "@/modules/tasks/sub-kpi-completion-mode";
import { isSubKpiEffectivelyVerified } from "@/modules/tasks/task-completion-verification";

export const KPI_ROW_SELECT = {
  id: true,
  title: true,
  mainTask: true,
  assignedAgentId: true,
  assignedAgent: { select: { id: true, name: true } },
  subKpis: true,
  isRecurring: true,
  frequency: true,
  recurrenceWeekday: true,
  recurrenceMonthDay: true,
  periodCycleStartAt: true,
  periodKey: true,
  scopedCompanyTeamId: true,
} as const;

export type KpiRow = NonNullable<
  Awaited<
    ReturnType<
      typeof prisma.kpiMaintenance.findUnique<{ where: { id: string }; select: typeof KPI_ROW_SELECT }>
    >
  >
>;

export function checklistFullyComplete(
  subKpis: unknown,
  taskTitle?: string,
  opts?: { verificationEnabled?: boolean },
): boolean {
  // Segmented tasks cannot finalize while cards remain on Unassigned.
  if (hasItemsInUnassignedSegment(subKpis)) return false;
  const items = isItProjectEnvelope(subKpis)
    ? itProjectAllItems(parseItProjectSubKpis(subKpis))
    : collectChecklistProgressItems(subKpis, taskTitle);
  if (items.length === 0) return false;
  return items.every(
    (x) =>
      subKpiRequirementsMet(x) &&
      isSubKpiEffectivelyVerified(x, {
        parentCardEffectivelyVerified: false,
        verificationEnabled: opts?.verificationEnabled,
      }),
  );
}

export async function snapshotIfRecurring(kpiRow: KpiRow, subKpis: unknown, fallbackTz: string) {
  if (!kpiRow.isRecurring) return;
  const snapshotTz = timeZoneFromPeriodKey(kpiRow.periodKey) || fallbackTz;
  const workingDays = await getCompanyWorkingDays(kpiRow.scopedCompanyTeamId);
  await upsertKpiPeriodSnapshot(
    {
      id: kpiRow.id,
      title: kpiRow.title,
      frequency: kpiRow.frequency,
      subKpis,
      periodKey: kpiRow.periodKey,
      recurrenceWeekday: kpiRow.recurrenceWeekday,
      recurrenceMonthDay: kpiRow.recurrenceMonthDay,
      periodCycleStartAt: kpiRow.periodCycleStartAt,
      isRecurring: kpiRow.isRecurring,
      scopedCompanyTeamId: kpiRow.scopedCompanyTeamId,
      workingDays,
      assignedAgent: kpiRow.assignedAgent
        ? { id: kpiRow.assignedAgent.id, name: kpiRow.assignedAgent.name }
        : null,
    },
    snapshotTz,
  );
}
