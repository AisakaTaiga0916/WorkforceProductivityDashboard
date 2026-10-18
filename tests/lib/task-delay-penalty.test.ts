import { describe, expect, it } from "vitest";
import {
  penaltyAccrualDays,
  subKpiAccruedPenalty,
  subKpiPenaltyDays,
} from "@/modules/tasks/task-delay-penalty";
import { applyPenaltyToTaskEfficiency } from "@/modules/tasks/task-personnel-metrics";
import type { SubKpiItem } from "@/modules/tasks/kpi-subkpis";

const TZ = "Asia/Manila";

describe("penaltyAccrualDays", () => {
  it("counts inclusive calendar days from delay start", () => {
    const start = new Date("2026-06-02T00:00:00+08:00").getTime();
    const end = new Date("2026-06-04T10:00:00+08:00").getTime();
    expect(penaltyAccrualDays(start, end, TZ)).toBe(3);
  });
});

describe("subKpiAccruedPenalty", () => {
  const item: SubKpiItem = {
    id: "s1",
    title: "Check backups",
    dueDate: "2026-06-01",
    done: false,
    dailyPenaltyAmount: 5,
  };

  it("starts accruing the day after daily non-recurring due date", () => {
    const nowMs = new Date("2026-06-03T12:00:00+08:00").getTime();
    expect(
      subKpiPenaltyDays(item, {
        nowMs,
        timeZone: TZ,
        frequency: "DAILY",
        isRecurring: false,
        title: "SYSTEM MAINTENANCE",
      }),
    ).toBe(2);
    expect(
      subKpiAccruedPenalty(item, {
        nowMs,
        timeZone: TZ,
        frequency: "DAILY",
        isRecurring: false,
        title: "SYSTEM MAINTENANCE",
      }),
    ).toBe(10);
  });

  it("uses task default when sub-task penalty is unset", () => {
    const nowMs = new Date("2026-06-03T12:00:00+08:00").getTime();
    expect(
      subKpiAccruedPenalty(
        { ...item, dailyPenaltyAmount: undefined },
        {
          nowMs,
          timeZone: TZ,
          frequency: "DAILY",
          isRecurring: false,
          title: "SYSTEM MAINTENANCE",
          taskDailyPenaltyAmount: 3,
        },
      ),
    ).toBe(6);
  });

  it("accrues for recurring tasks after custom target date", () => {
    const nowMs = new Date("2026-06-03T12:00:00+08:00").getTime();
    expect(
      subKpiAccruedPenalty(item, {
        nowMs,
        timeZone: TZ,
        frequency: "MONTHLY",
        isRecurring: true,
        title: "PAYROLL",
      }),
    ).toBe(10);
  });

  it("accrues for recurring tasks from cycle deadline when no custom due", () => {
    const nowMs = new Date("2026-09-03T12:00:00+08:00").getTime();
    const deadlineMs = new Date("2026-09-01T00:00:00+08:00").getTime();
    expect(
      subKpiAccruedPenalty(
        { id: "s1", title: "Check backups", done: false },
        {
          nowMs,
          timeZone: TZ,
          frequency: "MONTHLY",
          isRecurring: true,
          title: "PAYROLL",
          recurringDeadlineMs: deadlineMs,
          taskDailyPenaltyAmount: 5,
        },
      ),
    ).toBe(15);
  });

  it("returns zero before delay boundary", () => {
    const nowMs = new Date("2026-06-01T23:00:00+08:00").getTime();
    expect(
      subKpiAccruedPenalty(item, {
        nowMs,
        timeZone: TZ,
        frequency: "DAILY",
        isRecurring: false,
        title: "SYSTEM MAINTENANCE",
      }),
    ).toBe(0);
  });
});

describe("applyPenaltyToTaskEfficiency", () => {
  it("reduces efficiency by penalty points but not below the 50% floor", () => {
    expect(applyPenaltyToTaskEfficiency(75, 10)).toBe(65);
    expect(applyPenaltyToTaskEfficiency(8, 20)).toBe(50);
    expect(applyPenaltyToTaskEfficiency(100, 80)).toBe(50);
  });
});
