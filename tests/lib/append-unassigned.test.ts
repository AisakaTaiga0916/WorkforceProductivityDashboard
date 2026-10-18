import { describe, expect, it } from "vitest";
import {
  appendSubKpiItem,
  ensureUnsegmentedSegment,
  hasItemsInUnassignedSegment,
  normalizeSubKpis,
  UNSEGMENTED_SEGMENT_ID,
  wrapForPersist,
} from "@/modules/tasks/kpi-subkpis";

describe("append to Unassigned preserves existing cards", () => {
  it("keeps prior Unassigned items when appending another", () => {
    const raw = wrapForPersist({
      segmented: true,
      segments: ensureUnsegmentedSegment([
        { id: "seg-a", label: "Phase A", items: [] },
        {
          id: UNSEGMENTED_SEGMENT_ID,
          label: "Unassigned",
          items: [{ id: "old-1", title: "First", done: false }],
        },
      ]),
    });

    const first = appendSubKpiItem(raw, { title: "Second", segmentId: UNSEGMENTED_SEGMENT_ID });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const n1 = normalizeSubKpis(first.json);
    expect(n1.segmented).toBe(true);
    if (!n1.segmented) return;
    const u1 = n1.segments.find((s) => s.id === UNSEGMENTED_SEGMENT_ID)!;
    expect(u1.items.map((i) => i.title).sort()).toEqual(["First", "Second"]);

    const second = appendSubKpiItem(first.json, { title: "Third", segmentId: UNSEGMENTED_SEGMENT_ID });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const n2 = normalizeSubKpis(second.json);
    if (!n2.segmented) return;
    const u2 = n2.segments.find((s) => s.id === UNSEGMENTED_SEGMENT_ID)!;
    expect(u2.items.map((i) => i.title).sort()).toEqual(["First", "Second", "Third"]);
    expect(hasItemsInUnassignedSegment(second.json)).toBe(true);
  });

  it("ensureUnsegmentedSegment keeps Unassigned items when rebuilding around named segments", () => {
    const segs = ensureUnsegmentedSegment([
      { id: "seg-a", label: "A", items: [] },
      {
        id: UNSEGMENTED_SEGMENT_ID,
        label: "Unassigned",
        items: [
          { id: "u1", title: "One", done: false },
          { id: "u2", title: "Two", done: false },
        ],
      },
    ]);
    const next = ensureUnsegmentedSegment([
      ...segs.filter((s) => s.id !== UNSEGMENTED_SEGMENT_ID),
      { id: "seg-b", label: "B", items: [] },
      {
        id: UNSEGMENTED_SEGMENT_ID,
        label: "Unassigned",
        items: [...(segs.find((s) => s.id === UNSEGMENTED_SEGMENT_ID)?.items ?? [])],
      },
    ]);
    const unassigned = next.find((s) => s.id === UNSEGMENTED_SEGMENT_ID)!;
    expect(unassigned.items.map((i) => i.title)).toEqual(["One", "Two"]);
  });
});
