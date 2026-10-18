import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import {
  RECURRING_INCOMPLETE_ROLLOVER_HOLD_DAYS,
  recurringIncompleteRolloverEligibleAt,
  recurringIncompleteRolloverHoldDays,
  recurringTaskHasDelay,
  taskKanbanDerivedStatus,
} from "@/modules/tasks/kpi-cycle-state";

const TZ = "Asia/Manila";

describe("recurring incomplete rollover hold", () => {
  it("requires 10 calendar days after cycle deadline", () => {
    expect(RECURRING_INCOMPLETE_ROLLOVER_HOLD_DAYS).toBe(10);
    const deadline = DateTime.fromISO("2026-09-01T00:00:00", { zone: TZ }).toJSDate();
    const eligible = recurringIncompleteRolloverEligibleAt(deadline, TZ);
    expect(DateTime.fromJSDate(eligible, { zone: TZ }).toISODate()).toBe("2026-09-11");
  });

  it("applies the hold only to monthly/quarterly/semi-annual cadences", () => {
    expect(recurringIncompleteRolloverHoldDays("MONTHLY")).toBe(10);
    expect(recurringIncompleteRolloverHoldDays("QUARTERLY")).toBe(10);
    expect(recurringIncompleteRolloverHoldDays("SEMI_ANNUAL")).toBe(10);
  });

  it("rolls daily/weekly cycles over immediately (no hold)", () => {
    expect(recurringIncompleteRolloverHoldDays("DAILY")).toBe(0);
    expect(recurringIncompleteRolloverHoldDays("WEEKLY")).toBe(0);
  });

  it("is eligible right at the cycle deadline when the hold is 0 days", () => {
    const deadline = DateTime.fromISO("2026-09-01T00:00:00", { zone: TZ }).toJSDate();
    const eligible = recurringIncompleteRolloverEligibleAt(deadline, TZ, 0);
    expect(DateTime.fromJSDate(eligible, { zone: TZ }).toISODate()).toBe("2026-09-01");
  });
});

describe("recurringTaskHasDelay", () => {
  const base = {
    isRecurring: true as const,
    frequency: "MONTHLY" as const,
    recurrenceMonthDay: 1,
    periodCycleStartAt: DateTime.fromISO("2026-08-01T00:00:00", { zone: TZ }).toJSDate(),
    title: "PAYROLL",
  };

  it("flags delay after custom subtask target", () => {
    const nowMs = DateTime.fromISO("2026-08-20T12:00:00", { zone: TZ }).toMillis();
    expect(
      recurringTaskHasDelay(
        {
          ...base,
          subKpis: {
            items: [{ id: "a", title: "A", done: false, dueDate: "2026-08-15" }],
          },
        },
        nowMs,
        TZ,
      ),
    ).toBe(true);
  });

  it("flags delay after cycle deadline when incomplete", () => {
    const nowMs = DateTime.fromISO("2026-09-02T12:00:00", { zone: TZ }).toMillis();
    expect(
      recurringTaskHasDelay(
        {
          ...base,
          subKpis: {
            items: [{ id: "a", title: "A", done: false }],
          },
        },
        nowMs,
        TZ,
      ),
    ).toBe(true);
  });

  it("puts overdue recurring work in Delayed column", () => {
    const nowMs = DateTime.fromISO("2026-09-02T12:00:00", { zone: TZ }).toMillis();
    expect(
      taskKanbanDerivedStatus(
        {
          ...base,
          subKpis: {
            items: [{ id: "a", title: "A", done: false }],
          },
        },
        { total: 1, done: 0, nowMs, timeZone: TZ },
      ),
    ).toBe("DELAYED");
  });
});

describe("daily recurring work never sits in Delayed", () => {
  const dailyBase = {
    isRecurring: true as const,
    frequency: "DAILY" as const,
    periodCycleStartAt: DateTime.fromISO("2026-08-11T00:00:00", { zone: TZ }).toJSDate(),
    title: "SYSTEMS AVAILABILITY",
  };

  it("keeps a stale (not-yet-rolled) incomplete daily cycle in CURRENT", () => {
    // Cycle anchored yesterday with a deadline already past and items still pending —
    // DAILY rolls forward immediately, so it must not be flagged delayed.
    const nowMs = DateTime.fromISO("2026-08-12T10:00:00", { zone: TZ }).toMillis();
    expect(
      taskKanbanDerivedStatus(
        {
          ...dailyBase,
          subKpis: {
            items: [
              { id: "a", title: "A", done: false },
              { id: "b", title: "B", done: false },
            ],
          },
        },
        { total: 2, done: 0, nowMs, timeZone: TZ },
      ),
    ).toBe("CURRENT");
    expect(
      recurringTaskHasDelay(
        {
          ...dailyBase,
          subKpis: { items: [{ id: "a", title: "A", done: false }] },
        },
        nowMs,
        TZ,
      ),
    ).toBe(false);
  });

  it("still flags a daily task with a missed custom sub-task target", () => {
    const nowMs = DateTime.fromISO("2026-08-12T10:00:00", { zone: TZ }).toMillis();
    expect(
      recurringTaskHasDelay(
        {
          ...dailyBase,
          subKpis: {
            items: [{ id: "a", title: "A", done: false, dueDate: "2026-08-10" }],
          },
        },
        nowMs,
        TZ,
      ),
    ).toBe(true);
  });
});
