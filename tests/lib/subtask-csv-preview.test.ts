import { describe, expect, it } from "vitest";
import type { TaskMetricsCadence } from "@/modules/tasks/task-metrics-range";
import { DateTime } from "luxon";
import { getDailyPeriodKey } from "@/modules/tasks/kpi-recurrence";
import { wrapForPersist } from "@/modules/tasks/kpi-subkpis";
import {
  buildSubtaskCsvPreviewForPillar,
  type KpiRowForSnapshot,
} from "@/modules/tasks/kpi-period-snapshots";

function kpiRow(overrides: Partial<KpiRowForSnapshot> & Pick<KpiRowForSnapshot, "id" | "frequency">): KpiRowForSnapshot {
  return {
    title: "DATA BACKUP",
    subKpis: wrapForPersist({
      segmented: false,
      flat: [
        { id: "ali", title: "ALI", done: true, completionVerificationStatus: "VERIFIED" },
        { id: "aci", title: "ACI", done: false },
      ],
    }),
    periodKey: null,
    recurrenceWeekday: null,
    recurrenceMonthDay: 1,
    periodCycleStartAt: null,
    isRecurring: true,
    assignedAgent: null,
    ...overrides,
  };
}

describe("buildSubtaskCsvPreviewForPillar", () => {
  it("builds daily rows with sub-task columns from live Task Board definitions", () => {
    const zone = "Asia/Manila";
    const ymd = "2026-03-02";
    const kpi = kpiRow({ id: "k1", frequency: "DAILY" });
    const nowKey = getDailyPeriodKey(DateTime.fromISO(ymd, { zone }).toJSDate(), zone);
    const preview = buildSubtaskCsvPreviewForPillar({
      pillar: "DATA BACKUP",
      pillarKpis: [kpi],
      metricsCadence: "DAILY" as TaskMetricsCadence,
      fromYmd: ymd,
      toYmd: ymd,
      zone,
      snapshotByKpiPeriod: new Map(),
      currentPeriodKeyFor: () => nowKey,
    });

    expect(preview?.columns).toEqual(["DATE", "ALI", "ACI", "EFF %"]);
    expect(preview?.rows).toHaveLength(1);
    expect(preview?.rows[0]?.[0]).toMatch(/March 2, 2026/);
    expect(preview?.rows[0]?.slice(1, 3)).toEqual(["TRUE", "FALSE"]);
    expect(preview?.rows[0]?.[3]).toBe("50%");
  });

  it("builds monthly rows for Jan through Dec with abbreviated month labels", () => {
    const zone = "Asia/Manila";
    const kpi = kpiRow({ id: "k2", frequency: "MONTHLY" });
    const preview = buildSubtaskCsvPreviewForPillar({
      pillar: "SYSTEM MAINTENANCE",
      pillarKpis: [kpi],
      metricsCadence: "MONTHLY",
      fromYmd: "2026-01-01",
      toYmd: "2026-12-31",
      zone,
      snapshotByKpiPeriod: new Map(),
      currentPeriodKeyFor: () => "monthly:Asia/Manila:2026-03:1",
    });

    expect(preview?.rows).toHaveLength(12);
    expect(preview?.rows[0]?.[0]).toBe(
      DateTime.fromObject({ year: 2026, month: 1, day: 1 }, { zone }).toFormat("LLL. yyyy", { locale: "en" }),
    );
    expect(preview?.rows[11]?.[0]).toBe(
      DateTime.fromObject({ year: 2026, month: 12, day: 1 }, { zone }).toFormat("LLL. yyyy", { locale: "en" }),
    );
  });
});
