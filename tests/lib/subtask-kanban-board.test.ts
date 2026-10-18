import { describe, expect, it } from "vitest";
import {
  ensureUnsegmentedSegment,
  hasItemsInUnassignedSegment,
  moveSubKpiItemOnBoard,
  normalizeSubKpis,
  UNSEGMENTED_SEGMENT_ID,
  UNSEGMENTED_SEGMENT_LABEL,
  validateSegmentStructureForPersist,
  wrapForPersist,
} from "@/modules/tasks/kpi-subkpis";

describe("subtask kanban board moves (Trello-style segments)", () => {
  const base = {
    segmented: true as const,
    segments: ensureUnsegmentedSegment([
      {
        id: "seg-a",
        label: "Phase A",
        items: [{ id: "a1", title: "Wire up", done: false, projectStatus: "Pending" as const }],
      },
      {
        id: "seg-b",
        label: "Phase B",
        items: [],
      },
    ]),
  };

  it("ensures an Unassigned column exists last", () => {
    const segs = ensureUnsegmentedSegment([{ id: "x", label: "Only", items: [] }]);
    expect(segs.some((s) => s.id === UNSEGMENTED_SEGMENT_ID)).toBe(true);
    expect(segs[segs.length - 1]?.id).toBe(UNSEGMENTED_SEGMENT_ID);
    expect(segs[segs.length - 1]?.label).toBe(UNSEGMENTED_SEGMENT_LABEL);
  });

  it("moves a subtask between segment columns", () => {
    const raw = wrapForPersist(base);
    const result = moveSubKpiItemOnBoard(raw, "a1", {
      targetSegmentId: "seg-b",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const n = normalizeSubKpis(result.json);
    expect(n.segmented).toBe(true);
    if (!n.segmented) return;
    const a = n.segments.find((s) => s.id === "seg-a");
    const b = n.segments.find((s) => s.id === "seg-b");
    expect(a?.items).toHaveLength(0);
    expect(b?.items).toHaveLength(1);
    expect(b?.items[0]?.id).toBe("a1");
  });

  it("moves into Unassigned by reserved segment id", () => {
    const raw = wrapForPersist(base);
    const result = moveSubKpiItemOnBoard(raw, "a1", {
      targetSegmentId: UNSEGMENTED_SEGMENT_ID,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const n = normalizeSubKpis(result.json);
    if (!n.segmented) return;
    const general = n.segments.find((s) => s.id === UNSEGMENTED_SEGMENT_ID);
    expect(general?.items[0]?.id).toBe("a1");
    expect(hasItemsInUnassignedSegment(result.json)).toBe(true);
  });

  it("blocks finalize/persist while Unassigned still has sub-tasks", () => {
    const blocked = validateSegmentStructureForPersist(
      true,
      [],
      ensureUnsegmentedSegment([
        {
          id: "seg-a",
          label: "Phase A",
          items: [],
        },
        {
          id: UNSEGMENTED_SEGMENT_ID,
          label: UNSEGMENTED_SEGMENT_LABEL,
          items: [{ id: "waiting", title: "Waiting", done: false }],
        },
      ]),
    );
    expect(blocked.ok).toBe(false);

    const ok = validateSegmentStructureForPersist(
      true,
      [],
      ensureUnsegmentedSegment([
        {
          id: "seg-a",
          label: "Phase A",
          items: [{ id: "assigned", title: "Assigned work", done: false }],
        },
      ]),
    );
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(hasItemsInUnassignedSegment(wrapForPersist(ok.norm))).toBe(false);
  });
});
