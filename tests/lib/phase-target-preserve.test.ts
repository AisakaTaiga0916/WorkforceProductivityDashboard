import { describe, expect, it } from "vitest";
import {
  parseItProjectSubKpis,
  seedJoLinkedProjectTimeline,
  syncPhaseDueFromSubtasks,
} from "@/modules/tasks/it-project-subkpis";
import {
  markProjectTask,
  setLinkedJobOrderOnSubKpis,
  setTaskTargetDueDate,
  UNSEGMENTED_SEGMENT_ID,
  UNSEGMENTED_SEGMENT_LABEL,
  wrapForPersist,
} from "@/modules/tasks/kpi-subkpis";

describe("phase target dates survive project seed", () => {
  it("keeps distinct phase due dates from Make Phases create", () => {
    let raw: unknown = wrapForPersist({
      segmented: true,
      segments: [
        {
          id: "p1",
          label: "Phase 1",
          dueDate: "2026-07-01",
          items: [{ id: "a", title: "TASK 1.1", done: false }],
        },
        {
          id: "p2",
          label: "Phase 2",
          dueDate: "2026-08-01",
          items: [{ id: "b", title: "TASK 2.1", done: false }],
        },
        { id: UNSEGMENTED_SEGMENT_ID, label: UNSEGMENTED_SEGMENT_LABEL, items: [] },
      ],
    });
    raw = setTaskTargetDueDate(raw, "2026-08-25");
    raw = markProjectTask(raw);
    raw = setLinkedJobOrderOnSubKpis(raw, { ticketId: "jo", ticketNumber: "JO-1" });
    raw = seedJoLinkedProjectTimeline(raw, { targetDueDate: "2026-08-25" });

    const parsed = parseItProjectSubKpis(raw);
    expect(parsed.phases).toHaveLength(2);
    expect(parsed.phases[0]!.dueDate).toBe("2026-07-01");
    expect(parsed.phases[1]!.dueDate).toBe("2026-08-01");
    expect((raw as { pillarDueDate?: string }).pillarDueDate).toBe("2026-08-25");
  });

  it("does not wipe explicit phase due when subtasks have no dues", () => {
    const synced = syncPhaseDueFromSubtasks({
      id: "p1",
      name: "Phase 1",
      dueDate: "2026-07-15",
      items: [{ id: "a", title: "TASK 1.1", done: false }],
    });
    expect(synced.dueDate).toBe("2026-07-15");
  });

  it("keeps the later of explicit phase due and subtask dues", () => {
    expect(
      syncPhaseDueFromSubtasks({
        id: "p1",
        name: "Phase 1",
        dueDate: "2026-07-10",
        items: [{ id: "a", title: "A", done: false, dueDate: "2026-07-20" }],
      }).dueDate,
    ).toBe("2026-07-20");
    expect(
      syncPhaseDueFromSubtasks({
        id: "p1",
        name: "Phase 1",
        dueDate: "2026-08-01",
        items: [{ id: "a", title: "A", done: false, dueDate: "2026-07-20" }],
      }).dueDate,
    ).toBe("2026-08-01");
  });
});
