import { describe, expect, it } from "vitest";
import {
  alternateGmt8PeriodKey,
  indexSnapshotsByKpiPeriod,
  kpiMaintenanceWhereForTaskMetrics,
  periodKeysWithGmt8Aliases,
  snapshotTimeZoneForTaskMetrics,
} from "@/modules/tasks/kpi-period-snapshots";

describe("snapshotTimeZoneForTaskMetrics", () => {
  it("prefers KPI_SNAPSHOT_TZ over client tz", () => {
    const prev = process.env.KPI_SNAPSHOT_TZ;
    process.env.KPI_SNAPSHOT_TZ = "Asia/Manila";
    expect(snapshotTimeZoneForTaskMetrics("UTC")).toBe("Asia/Manila");
    if (prev === undefined) delete process.env.KPI_SNAPSHOT_TZ;
    else process.env.KPI_SNAPSHOT_TZ = prev;
  });

  it("falls back to Asia/Taipei when client sends UTC and env is unset", () => {
    const prevSnap = process.env.KPI_SNAPSHOT_TZ;
    const prevReport = process.env.REPORT_TZ;
    const prevApp = process.env.APP_TIME_ZONE;
    delete process.env.KPI_SNAPSHOT_TZ;
    delete process.env.REPORT_TZ;
    delete process.env.APP_TIME_ZONE;
    expect(snapshotTimeZoneForTaskMetrics("UTC")).toBe("Asia/Taipei");
    if (prevSnap === undefined) delete process.env.KPI_SNAPSHOT_TZ;
    else process.env.KPI_SNAPSHOT_TZ = prevSnap;
    if (prevReport === undefined) delete process.env.REPORT_TZ;
    else process.env.REPORT_TZ = prevReport;
    if (prevApp === undefined) delete process.env.APP_TIME_ZONE;
    else process.env.APP_TIME_ZONE = prevApp;
  });
});

describe("GMT+8 period key aliases", () => {
  it("swaps Asia/Manila and Asia/Taipei in period keys", () => {
    expect(alternateGmt8PeriodKey("D:Asia/Manila:2026-04-01")).toBe("D:Asia/Taipei:2026-04-01");
    expect(alternateGmt8PeriodKey("D:Asia/Taipei:2026-04-01")).toBe("D:Asia/Manila:2026-04-01");
    expect(alternateGmt8PeriodKey("M:Asia/Manila:2026-04-01")).toBe("M:Asia/Taipei:2026-04-01");
    expect(alternateGmt8PeriodKey("D:2026-04-01")).toBeNull();
  });

  it("expands query keys with both GMT+8 forms", () => {
    expect(periodKeysWithGmt8Aliases(["D:Asia/Taipei:2026-05-01"]).sort()).toEqual([
      "D:Asia/Manila:2026-05-01",
      "D:Asia/Taipei:2026-05-01",
    ]);
  });

  it("indexes Manila snapshots under Taipei lookup keys", () => {
    const map = indexSnapshotsByKpiPeriod([
      {
        kpiMaintenanceId: "kpi-1",
        periodKey: "D:Asia/Manila:2026-04-15",
        percent: 80,
      },
    ]);
    expect(map.get("kpi-1:D:Asia/Manila:2026-04-15")?.percent).toBe(80);
    expect(map.get("kpi-1:D:Asia/Taipei:2026-04-15")?.percent).toBe(80);
  });

  it("prefers the exact key when both aliases are present", () => {
    const map = indexSnapshotsByKpiPeriod([
      { kpiMaintenanceId: "kpi-1", periodKey: "D:Asia/Manila:2026-04-15", percent: 80 },
      { kpiMaintenanceId: "kpi-1", periodKey: "D:Asia/Taipei:2026-04-15", percent: 100 },
    ]);
    expect(map.get("kpi-1:D:Asia/Manila:2026-04-15")?.percent).toBe(80);
    expect(map.get("kpi-1:D:Asia/Taipei:2026-04-15")?.percent).toBe(100);
  });
});

describe("kpiMaintenanceWhereForTaskMetrics", () => {
  it("scopes personnel metrics to their assigned KPIs only", () => {
    expect(kpiMaintenanceWhereForTaskMetrics("agent-1")).toEqual({
      assignedAgentId: "agent-1",
    });
  });
});
