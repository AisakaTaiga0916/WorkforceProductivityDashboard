import { describe, expect, it } from "vitest";
import {
  advanceDueDateYmdForFrequency,
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

describe("daily KPI recurrence with per-company working-day masks", () => {
  const MON_FRI = [1, 2, 3, 4, 5];
  const SUNDAY_ONLY = [7];

  it("Mon–Fri mask skips weekends back to Friday and forward to Monday", () => {
    const sunday = DateTime.fromISO("2026-05-24T10:00:00", { zone: TZ }).toJSDate();

    expect(getDailyPeriodKey(sunday, TZ, MON_FRI)).toBe("D:Asia/Manila:2026-05-22");
    expect(
      getNextDailyPeriodStartDt(DateTime.fromISO("2026-05-22T00:00:00", { zone: TZ }), MON_FRI).toISODate(),
    ).toBe("2026-05-25");
    expect(
      getPeriodEndExclusiveFromCycleStart(
        DateTime.fromISO("2026-05-22T00:00:00", { zone: TZ }).toJSDate(),
        "DAILY",
        null,
        null,
        TZ,
        MON_FRI,
      ),
    ).toEqual(DateTime.fromISO("2026-05-25T00:00:00", { zone: TZ }).toJSDate());
  });

  it("Sunday-only mask walks back from Monday and rolls a Sunday completion to next Sunday", () => {
    const monday = DateTime.fromISO("2026-05-25T09:00:00", { zone: TZ }).toJSDate();
    expect(getDailyPeriodKey(monday, TZ, SUNDAY_ONLY)).toBe("D:Asia/Manila:2026-05-24");

    const sundayComplete = DateTime.fromISO("2026-05-24T15:00:00", { zone: TZ }).toJSDate();
    expect(getRolloverEligibleAfterCompletion(sundayComplete, TZ, "DAILY", SUNDAY_ONLY)).toEqual(
      DateTime.fromISO("2026-05-31T00:00:00", { zone: TZ }).toJSDate(),
    );
  });

  it("advances DAILY due dates along the mask", () => {
    expect(advanceDueDateYmdForFrequency("2026-05-22", "DAILY", TZ, MON_FRI)).toBe("2026-05-25");
    expect(advanceDueDateYmdForFrequency("2026-05-24", "DAILY", TZ, SUNDAY_ONLY)).toBe("2026-05-31");
  });
});
