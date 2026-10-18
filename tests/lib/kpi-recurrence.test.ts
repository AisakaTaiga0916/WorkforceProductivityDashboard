import { describe, expect, it } from "vitest";
import {
  getDailyPeriodKey,
  getNextDailyPeriodStartDt,
  getPeriodEndExclusiveFromCycleStart,
  getRolloverEligibleAfterCompletion,
} from "@/modules/tasks/kpi-recurrence";
import { getPeriodStartInclusive } from "@/modules/tasks/kpi-period-window";
import { DateTime } from "luxon";

const TZ = "Asia/Manila";

describe("daily KPI recurrence", () => {
  it("uses Saturday's daily period on Sunday", () => {
    const sunday = DateTime.fromISO("2026-05-24T10:00:00", { zone: TZ }).toJSDate();

    expect(getDailyPeriodKey(sunday, TZ)).toBe("D:Asia/Manila:2026-05-23");
    expect(getPeriodStartInclusive("DAILY", null, null, sunday, TZ)).toEqual(
      DateTime.fromISO("2026-05-23T00:00:00", { zone: TZ }).toJSDate(),
    );
  });

  it("rolls Saturday daily tasks to Monday", () => {
    const saturdayStart = DateTime.fromISO("2026-05-23T00:00:00", { zone: TZ });
    const saturdayComplete = DateTime.fromISO("2026-05-23T15:00:00", { zone: TZ }).toJSDate();

    expect(getNextDailyPeriodStartDt(saturdayStart).toISODate()).toBe("2026-05-25");
    expect(getPeriodEndExclusiveFromCycleStart(saturdayStart.toJSDate(), "DAILY", null, null, TZ)).toEqual(
      DateTime.fromISO("2026-05-25T00:00:00", { zone: TZ }).toJSDate(),
    );
    expect(getRolloverEligibleAfterCompletion(saturdayComplete, TZ)).toEqual(
      DateTime.fromISO("2026-05-25T00:00:00", { zone: TZ }).toJSDate(),
    );
    expect(getRolloverEligibleAfterCompletion(saturdayComplete, TZ, "DAILY")).toEqual(
      DateTime.fromISO("2026-05-25T00:00:00", { zone: TZ }).toJSDate(),
    );
  });

  it("allows weekly/monthly/quarterly rollover immediately on completion (no +1 day wait)", () => {
    const completedAt = DateTime.fromISO("2026-05-20T14:30:00", { zone: TZ }).toJSDate();
    for (const frequency of ["WEEKLY", "MONTHLY", "QUARTERLY"] as const) {
      expect(getRolloverEligibleAfterCompletion(completedAt, TZ, frequency).getTime()).toBe(
        completedAt.getTime(),
      );
    }
  });
});
