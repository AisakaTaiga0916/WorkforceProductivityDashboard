import { describe, expect, it } from "vitest";
import { wrapItProjectSubKpis, type ItProjectData } from "@/modules/tasks/it-project-subkpis";
import { setTaskDailyPenaltyAmount, setTaskDelayPenaltyFrequency } from "@/modules/tasks/kpi-subkpis";
import {
  penaltyAccrualUnits,
  penaltyDeductionsForKpi,
  subKpiAccruedPenalty,
} from "@/modules/tasks/task-delay-penalty";

describe("penaltyAccrualUnits", () => {
  it("uses calendar days for DAILY", () => {
    expect(penaltyAccrualUnits(0, "DAILY")).toBe(0);
    expect(penaltyAccrualUnits(3, "DAILY")).toBe(3);
  });

  it("ceils weekly and monthly buckets", () => {
    expect(penaltyAccrualUnits(1, "WEEKLY")).toBe(1);
    expect(penaltyAccrualUnits(7, "WEEKLY")).toBe(1);
    expect(penaltyAccrualUnits(8, "WEEKLY")).toBe(2);
    expect(penaltyAccrualUnits(1, "MONTHLY")).toBe(1);
    expect(penaltyAccrualUnits(30, "MONTHLY")).toBe(1);
    expect(penaltyAccrualUnits(31, "MONTHLY")).toBe(2);
  });
});

describe("IT project delay penalty", () => {
  it("accrues daily penalty for overdue incomplete IT subtasks", () => {
    const data: ItProjectData = {
      activePhaseId: "p1",
      phases: [
        {
          id: "p1",
          name: "Phase 1",
          dueDate: "2026-07-01",
          items: [
            {
              id: "s1",
              title: "Late work",
              done: false,
              dueDate: "2026-07-01",
              assignedAgentId: "agent-1",
              assignedAgentName: "Ada",
            },
          ],
        },
      ],
    };
    let raw = wrapItProjectSubKpis(data);
    raw = setTaskDailyPenaltyAmount(raw, 2);
    const nowMs = new Date("2026-07-04T12:00:00.000Z").getTime();
    const map = penaltyDeductionsForKpi(
      {
        subKpis: raw,
        frequency: "DAILY",
        isRecurring: false,
        title: "IT PROJECT IMPLEMENTATION",
      },
      { nowMs, timeZone: "Asia/Manila" },
    );
    expect(map.size).toBe(1);
    const row = [...map.values()][0]!;
    expect(row.deduction).toBeGreaterThan(0);

    const item = data.phases[0]!.items[0]!;
    const pts = subKpiAccruedPenalty(item, {
      nowMs,
      timeZone: "Asia/Manila",
      frequency: "DAILY",
      isRecurring: false,
      title: "IT PROJECT IMPLEMENTATION",
      taskDailyPenaltyAmount: 2,
      phaseDueDate: "2026-07-01",
    });
    expect(pts).toBe(row.deduction);
  });

  it("applies weekly ceil buckets for IT subtasks", () => {
    const item = {
      id: "s1",
      title: "Late work",
      done: false,
      dueDate: "2026-07-01",
      assignedAgentId: "agent-1",
      assignedAgentName: "Ada",
    };
    // Due 2026-07-01 → delay starts Jul 2. Now Jul 10 → 9 inclusive days → ceil(9/7)=2 weeks × 10 = 20
    const nowMs = new Date("2026-07-10T04:00:00.000Z").getTime();
    const pts = subKpiAccruedPenalty(item, {
      nowMs,
      timeZone: "Asia/Manila",
      frequency: "DAILY",
      isRecurring: false,
      title: "IT PROJECT IMPLEMENTATION",
      taskDailyPenaltyAmount: 10,
      taskDelayPenaltyFrequency: "WEEKLY",
      phaseDueDate: "2026-07-01",
    });
    expect(pts).toBe(20);

    let raw = wrapItProjectSubKpis({
      activePhaseId: "p1",
      phases: [{ id: "p1", name: "Phase 1", dueDate: "2026-07-01", items: [item] }],
    });
    raw = setTaskDailyPenaltyAmount(raw, 10);
    raw = setTaskDelayPenaltyFrequency(raw, "WEEKLY");
    const map = penaltyDeductionsForKpi(
      {
        subKpis: raw,
        frequency: "DAILY",
        isRecurring: false,
        title: "IT PROJECT IMPLEMENTATION",
      },
      { nowMs, timeZone: "Asia/Manila" },
    );
    expect([...map.values()][0]!.deduction).toBe(20);
  });
});
