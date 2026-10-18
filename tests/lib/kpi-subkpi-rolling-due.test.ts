import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import {
  advanceDueDateYmdForFrequency,
  countRecurrencePeriodsBetween,
} from "@/modules/tasks/kpi-recurrence";
import { collectAllSubKpiItems, normalizeSubKpis, resetAllSubKpiDone } from "@/modules/tasks/kpi-subkpis";

const TZ = "Asia/Manila";

describe("rolling sub-task due dates", () => {
  it("advances monthly due dates by calendar month with day clamp", () => {
    expect(advanceDueDateYmdForFrequency("2026-08-15", "MONTHLY", TZ)).toBe("2026-09-15");
    expect(advanceDueDateYmdForFrequency("2026-01-31", "MONTHLY", TZ)).toBe("2026-02-28");
  });

  it("advances weekly due dates by one week", () => {
    expect(advanceDueDateYmdForFrequency("2026-08-10", "WEEKLY", TZ)).toBe("2026-08-17");
  });

  it("counts skipped monthly periods between cycle starts", () => {
    const from = DateTime.fromISO("2026-06-01", { zone: TZ }).startOf("day").toJSDate();
    const to = DateTime.fromISO("2026-09-01", { zone: TZ }).startOf("day").toJSDate();
    expect(countRecurrencePeriodsBetween(from, to, "MONTHLY", null, 1, TZ)).toBe(3);
  });

  it("advances only flagged custom dues on resetAllSubKpiDone", () => {
    const from = DateTime.fromISO("2026-08-01", { zone: TZ }).startOf("day").toJSDate();
    const to = DateTime.fromISO("2026-09-01", { zone: TZ }).startOf("day").toJSDate();
    const raw = {
      items: [
        {
          id: "a",
          title: "Rolls",
          done: true,
          dueDate: "2026-08-15",
          dueDateRollsWithCycle: true,
        },
        {
          id: "b",
          title: "Fixed",
          done: true,
          dueDate: "2026-08-20",
        },
        {
          id: "c",
          title: "Inherit",
          done: true,
        },
      ],
    };

    const reset = resetAllSubKpiDone(raw, {
      frequency: "MONTHLY",
      recurrenceMonthDay: 1,
      timeZone: TZ,
      fromCycleStart: from,
      toCycleStart: to,
    });
    const items = collectAllSubKpiItems(normalizeSubKpis(reset));
    expect(items.find((it) => it.id === "a")?.dueDate).toBe("2026-09-15");
    expect(items.find((it) => it.id === "a")?.dueDateRollsWithCycle).toBe(true);
    expect(items.find((it) => it.id === "a")?.done).toBe(false);
    expect(items.find((it) => it.id === "b")?.dueDate).toBe("2026-08-20");
    expect(items.find((it) => it.id === "c")?.dueDate).toBeUndefined();
  });

  it("advances rolling dues across multiple skipped cycles", () => {
    const from = DateTime.fromISO("2026-06-01", { zone: TZ }).startOf("day").toJSDate();
    const to = DateTime.fromISO("2026-09-01", { zone: TZ }).startOf("day").toJSDate();
    const reset = resetAllSubKpiDone(
      {
        items: [
          {
            id: "a",
            title: "Rolls",
            done: false,
            dueDate: "2026-06-15",
            dueDateRollsWithCycle: true,
          },
        ],
      },
      {
        frequency: "MONTHLY",
        recurrenceMonthDay: 1,
        timeZone: TZ,
        fromCycleStart: from,
        toCycleStart: to,
      },
    );
    expect(collectAllSubKpiItems(normalizeSubKpis(reset))[0]?.dueDate).toBe("2026-09-15");
  });
});
