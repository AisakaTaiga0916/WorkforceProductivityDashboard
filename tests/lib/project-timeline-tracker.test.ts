import { describe, expect, it } from "vitest";
import {
  applyPhaseDelayNotifications,
  buildItProjectFromPhaseDrafts,
  isItProjectEnvelope,
  isItProjectPhaseDelayed,
  parseItProjectSubKpis,
  phaseTargetDateFromSubtasks,
  seedJoLinkedProjectTimeline,
  setItProjectSubKpiLifecycle,
  setItProjectSubKpiSchedule,
  syncPhaseDueFromSubtasks,
  usesProjectTimelineTracker,
  wrapItProjectSubKpis,
} from "@/modules/tasks/it-project-subkpis";
import { getLinkedJobOrderFromSubKpis, isProjectTask, markProjectTask, setLinkedJobOrderOnSubKpis } from "@/modules/tasks/kpi-subkpis";

describe("phase target date from subtasks", () => {
  it("derives max due date and syncs onto the phase", () => {
    const phase = {
      id: "p1",
      name: "Phase 1",
      items: [
        { id: "a", title: "A", done: false, dueDate: "2026-07-10" },
        { id: "b", title: "B", done: false, dueDate: "2026-07-25" },
        { id: "c", title: "C", done: false },
      ],
    };
    expect(phaseTargetDateFromSubtasks(phase)).toBe("2026-07-25");
    expect(syncPhaseDueFromSubtasks(phase).dueDate).toBe("2026-07-25");
  });

  it("updates phase due when a subtask due changes via schedule helper", () => {
    const built = buildItProjectFromPhaseDrafts([
      {
        name: "Phase 1",
        items: [
          { title: "Early", dueDate: "2026-07-10" },
          { title: "Late", dueDate: "2026-07-20" },
        ],
      },
    ]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.data.phases[0]!.dueDate).toBe("2026-07-20");
    const lateId = built.data.phases[0]!.items[1]!.id;
    const next = setItProjectSubKpiSchedule(wrapItProjectSubKpis(built.data), lateId, {
      dueDate: "2026-08-05",
    });
    const parsed = parseItProjectSubKpis(next);
    expect(parsed.phases[0]!.items[1]!.dueDate).toBe("2026-08-05");
    expect(parsed.phases[0]!.dueDate).toBe("2026-08-05");
  });

  it("allows subtask due after a previously stored phase due (phase tracks latest)", () => {
    const built = buildItProjectFromPhaseDrafts([
      {
        name: "Phase 1",
        dueDate: "2026-07-10",
        items: [{ title: "Late", dueDate: "2026-07-20" }],
      },
    ]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.data.phases[0]!.dueDate).toBe("2026-07-20");
  });
});

describe("JO-linked project timeline seed", () => {
  it("seeds an it_project envelope and keeps JO + project meta", () => {
    let raw: unknown = markProjectTask({});
    raw = setLinkedJobOrderOnSubKpis(raw, { ticketId: "jo-1", ticketNumber: "JO-100" });
    raw = seedJoLinkedProjectTimeline(raw);
    expect(isItProjectEnvelope(raw)).toBe(true);
    expect(usesProjectTimelineTracker(raw)).toBe(true);
    expect(isProjectTask(raw)).toBe(true);
    expect(getLinkedJobOrderFromSubKpis(raw)?.ticketId).toBe("jo-1");
    const parsed = parseItProjectSubKpis(raw);
    expect(parsed.phases).toHaveLength(1);
    expect(parsed.phases[0]!.items).toHaveLength(0);
  });

  it("seeds main + phase target dates from the Job Order target", () => {
    let raw: unknown = markProjectTask({});
    raw = setLinkedJobOrderOnSubKpis(raw, { ticketId: "jo-2", ticketNumber: "JO-200" });
    raw = seedJoLinkedProjectTimeline(raw, { targetDueDate: "2026-08-15" });
    const parsed = parseItProjectSubKpis(raw);
    expect(parsed.phases[0]!.dueDate).toBe("2026-08-15");
    expect(parsed.phases[0]!.items).toHaveLength(0);
    expect((raw as { pillarDueDate?: string }).pillarDueDate).toBe("2026-08-15");
  });
});

describe("phase delay detection + notify dedupe", () => {
  it("flags incomplete phases past target and notifies once per day", () => {
    const built = buildItProjectFromPhaseDrafts([
      {
        name: "Discovery",
        items: [{ title: "Kickoff", dueDate: "2026-01-01" }],
      },
    ]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const phase = {
      ...built.data.phases[0]!,
      items: [
        {
          ...built.data.phases[0]!.items[0]!,
          assignedAgentId: "agent-1",
          assignedAgentName: "Alex",
        },
      ],
    };
    const data = { activePhaseId: phase.id, phases: [phase] };
    const nowMs = Date.parse("2026-07-18T12:00:00+08:00");
    expect(isItProjectPhaseDelayed(phase, "Asia/Manila", nowMs)).toBe(true);

    const first = applyPhaseDelayNotifications(wrapItProjectSubKpis(data), {
      timeZone: "Asia/Manila",
      nowMs,
      cardAssignedAgentId: null,
    });
    expect(first.notifications).toHaveLength(1);
    expect(first.notifications[0]!.agentIds).toContain("agent-1");
    expect(parseItProjectSubKpis(first.json).phases[0]!.lastDelayNotifiedOn).toBe("2026-07-18");

    const second = applyPhaseDelayNotifications(first.json, {
      timeZone: "Asia/Manila",
      nowMs,
      cardAssignedAgentId: null,
    });
    expect(second.notifications).toHaveLength(0);
  });
});

describe("Start/End GPS lifecycle", () => {
  it("stores timestamps and coordinates on start/end", () => {
    const built = buildItProjectFromPhaseDrafts([
      {
        name: "Phase 1",
        items: [{ title: "Work", dueDate: "2026-12-31" }],
      },
    ]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const id = built.data.phases[0]!.items[0]!.id;
    const started = setItProjectSubKpiLifecycle(wrapItProjectSubKpis(built.data), id, "start", "Asia/Manila", {
      latitude: 14.5995,
      longitude: 120.9842,
      capturedAt: "2026-07-18T03:00:00.000Z",
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const afterStart = parseItProjectSubKpis(started.json).phases[0]!.items[0]!;
    expect(afterStart.startedAt).toBe("2026-07-18T03:00:00.000Z");
    expect(afterStart.startedLatitude).toBe(14.5995);
    expect(afterStart.startedLongitude).toBe(120.9842);
    expect(afterStart.startDate).toBeTruthy();

    const ended = setItProjectSubKpiLifecycle(started.json, id, "end", "Asia/Manila", {
      latitude: 14.6,
      longitude: 120.99,
      capturedAt: "2026-07-18T05:00:00.000Z",
    });
    expect(ended.ok).toBe(true);
    if (!ended.ok) return;
    const afterEnd = parseItProjectSubKpis(ended.json).phases[0]!.items[0]!;
    expect(afterEnd.endedAt).toBe("2026-07-18T05:00:00.000Z");
    expect(afterEnd.endedLatitude).toBe(14.6);
    expect(afterEnd.done).toBe(true);
  });
});
