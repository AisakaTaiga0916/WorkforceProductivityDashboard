import { describe, expect, it } from "vitest";
import {
  isNonRecurringSubKpiDelayed,
  nonRecurringDelayStartExclusive,
  taskKanbanDerivedStatus,
} from "@/modules/tasks/kpi-cycle-state";

const TZ = "Asia/Manila";

describe("nonRecurringDelayStartExclusive", () => {
  it("delay starts at midnight the day after target date", () => {
    const start = nonRecurringDelayStartExclusive("2026-06-15", TZ);
    expect(start?.toISOString()).toBe(new Date("2026-06-15T16:00:00.000Z").toISOString());
  });
});

describe("taskKanbanDerivedStatus for non-recurring tasks", () => {
  const subKpis = {
    segmented: false,
    items: [
      {
        id: "s1",
        title: "Check metric",
        done: false,
        dueDate: "2026-06-15",
        completionRequirements: { checkbox: true, screenshots: false, screenshotUpload: false, numerical: false },
      },
    ],
  };

  it("marks non-recurring task DELAYED after next-day midnight", () => {
    const nowMs = new Date("2026-06-16T16:00:00.000Z").getTime();
    expect(
      taskKanbanDerivedStatus(
        { isRecurring: false, frequency: "MONTHLY", title: "OPS CHECK", subKpis },
        { total: 1, done: 0, nowMs, timeZone: TZ },
      ),
    ).toBe("DELAYED");
  });

  it("keeps non-recurring task CURRENT before next-day midnight", () => {
    const nowMs = new Date("2026-06-15T15:00:00.000Z").getTime();
    expect(
      taskKanbanDerivedStatus(
        { isRecurring: false, frequency: "MONTHLY", title: "OPS CHECK", subKpis },
        { total: 1, done: 0, nowMs, timeZone: TZ },
      ),
    ).toBe("CURRENT");
  });

  it("ignores stored frequency — monthly label does not push delay to next month", () => {
    const nowMs = new Date("2026-06-30T16:00:00.000Z").getTime();
    expect(
      taskKanbanDerivedStatus(
        { isRecurring: false, frequency: "MONTHLY", title: "OPS CHECK", subKpis },
        { total: 1, done: 0, nowMs, timeZone: TZ },
      ),
    ).toBe("DELAYED");
  });
});

describe("isNonRecurringSubKpiDelayed", () => {
  it("treats actual date on delay boundary as delayed", () => {
    expect(
      isNonRecurringSubKpiDelayed(
        {
          id: "s1",
          title: "Row",
          done: true,
          dueDate: "2026-06-15",
          actualDate: "2026-06-16",
          completionRequirements: { checkbox: true, screenshots: false, screenshotUpload: false, numerical: false },
        },
        new Date("2026-06-17T00:00:00.000Z").getTime(),
        TZ,
      ),
    ).toBe(true);
  });
});
