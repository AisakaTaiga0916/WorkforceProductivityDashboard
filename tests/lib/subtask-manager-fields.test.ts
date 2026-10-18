import { describe, expect, it } from "vitest";
import {
  appendSubKpiItem,
  collectAllSubKpiItems,
  copySubKpiItemsToSegments,
  normalizeSubKpis,
  removeSubKpiItem,
  resolveEffectiveSubKpiDueDate,
  updateSubKpiItem,
} from "@/modules/tasks/kpi-subkpis";
import { listSubTaskDtos } from "@/modules/tasks/kpi-subtasks-rest";

const baseChecklist = [{ id: "a", title: "First step", done: false }];

describe("sub-task manager fields (description + priority)", () => {
  it("persists description and priority when appending a sub-task", () => {
    const result = appendSubKpiItem(baseChecklist, {
      title: "Write docs",
      description: "  Cover the new API endpoints  ",
      dueDate: "2026-08-01",
      projectPriority: "High",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const items = collectAllSubKpiItems(normalizeSubKpis(result.json));
    const added = items.find((it) => it.title === "Write docs");
    expect(added?.description).toBe("Cover the new API endpoints");
    expect(added?.projectPriority).toBe("High");
    expect(added?.dueDate).toBe("2026-08-01");
  });

  it("updates and clears description and priority on an existing sub-task", () => {
    const withDesc = updateSubKpiItem(baseChecklist, "a", {
      description: "Details here",
      projectPriority: "Medium",
    });
    expect(withDesc.ok).toBe(true);
    if (!withDesc.ok) return;
    let items = collectAllSubKpiItems(normalizeSubKpis(withDesc.json));
    expect(items[0]?.description).toBe("Details here");
    expect(items[0]?.projectPriority).toBe("Medium");

    const cleared = updateSubKpiItem(withDesc.json, "a", {
      description: null,
      projectPriority: null,
    });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    items = collectAllSubKpiItems(normalizeSubKpis(cleared.json));
    expect(items[0]?.description).toBeUndefined();
    expect(items[0]?.projectPriority).toBeUndefined();
  });

  it("rejects invalid priorities instead of persisting them", () => {
    const result = appendSubKpiItem(baseChecklist, {
      title: "Bad priority",
      projectPriority: "Urgent",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const items = collectAllSubKpiItems(normalizeSubKpis(result.json));
    expect(items.find((it) => it.title === "Bad priority")?.projectPriority).toBeUndefined();
  });

  it("maps sub-tasks to REST DTOs with derived status and assignee", () => {
    const checklist = [
      {
        id: "a",
        title: "First step",
        description: "Kick things off",
        done: true,
        assignedAgentId: "agent-1",
        assignedAgentName: "Alice",
        dueDate: "2026-08-05",
        projectPriority: "Low",
      },
      { id: "b", title: "Second step", done: false },
    ];
    const dtos = listSubTaskDtos(checklist);
    expect(dtos).toHaveLength(2);
    expect(dtos[0]).toMatchObject({
      id: "a",
      title: "First step",
      description: "Kick things off",
      status: "Done",
      done: true,
      assignee: { id: "agent-1", name: "Alice" },
      dueDate: "2026-08-05",
      priority: "Low",
    });
    expect(dtos[1]).toMatchObject({ id: "b", status: "Pending", done: false, assignee: null });
  });

  it("keeps at least one sub-task when deleting", () => {
    const result = removeSubKpiItem(baseChecklist, "a");
    expect(result.ok).toBe(false);
  });
});

describe("copySubKpiItemsToSegments", () => {
  const segmented = {
    segmented: true as const,
    segments: [
      {
        id: "seg-a",
        label: "Segment A",
        items: [
          {
            id: "s1",
            title: "Wire cabinets",
            description: "Rack A",
            done: true,
            projectPriority: "High" as const,
            dueDate: "2026-09-01",
            assignedAgentId: "agent-1",
            assignedAgentName: "Alice",
            actualDate: "2026-08-20",
            assistanceRequested: true,
          },
        ],
      },
      {
        id: "seg-b",
        label: "Segment B",
        items: [{ id: "s2", title: "Label ports", done: false }],
      },
      {
        id: "seg-c",
        label: "Segment C",
        items: [{ id: "s3", title: "Patch panel", done: false }],
      },
    ],
  };

  it("copies a sub-task into other segments without moving the original", () => {
    const result = copySubKpiItemsToSegments(segmented, {
      sourceIds: ["s1"],
      targetSegmentIds: ["seg-b", "seg-c"],
      keepDueDate: true,
      keepPriority: true,
      keepAssignee: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.copiedCount).toBe(2);
    const norm = normalizeSubKpis(result.json);
    expect(norm.segmented).toBe(true);
    if (!norm.segmented) return;
    expect(norm.segments[0]?.items).toHaveLength(1);
    expect(norm.segments[0]?.items[0]?.id).toBe("s1");
    expect(norm.segments[1]?.items).toHaveLength(2);
    expect(norm.segments[2]?.items).toHaveLength(2);
    const copyB = norm.segments[1]?.items.find((it) => it.title === "Wire cabinets" && it.id !== "s1");
    expect(copyB?.description).toBe("Rack A");
    expect(copyB?.projectPriority).toBe("High");
    expect(copyB?.dueDate).toBe("2026-09-01");
    expect(copyB?.done).toBe(false);
    expect(copyB?.actualDate).toBeUndefined();
    expect(copyB?.assistanceRequested).toBeUndefined();
    expect(copyB?.assignedAgentId).toBeUndefined();
  });

  it("keeps assignee when requested and rejects same-segment-only targets", () => {
    const withAssignee = copySubKpiItemsToSegments(segmented, {
      sourceIds: ["s1"],
      targetSegmentIds: ["seg-b"],
      keepAssignee: true,
    });
    expect(withAssignee.ok).toBe(true);
    if (!withAssignee.ok) return;
    const norm = normalizeSubKpis(withAssignee.json);
    if (!norm.segmented) return;
    const copy = norm.segments[1]?.items.find((it) => it.title === "Wire cabinets" && it.id !== "s1");
    expect(copy?.assignedAgentId).toBe("agent-1");

    const sameOnly = copySubKpiItemsToSegments(segmented, {
      sourceIds: ["s1"],
      targetSegmentIds: ["seg-a"],
    });
    expect(sameOnly.ok).toBe(false);

    const flatReject = copySubKpiItemsToSegments([{ id: "x", title: "Only" }], {
      sourceIds: ["x"],
      targetSegmentIds: ["seg-a"],
    });
    expect(flatReject.ok).toBe(false);
  });
});

describe("resolveEffectiveSubKpiDueDate", () => {
  it("uses custom due date when set and otherwise inherits the parent target", () => {
    expect(resolveEffectiveSubKpiDueDate({ dueDate: "2026-09-01" }, "2026-08-01")).toEqual({
      dueDate: "2026-09-01",
      inherits: false,
    });
    expect(resolveEffectiveSubKpiDueDate({ dueDate: null }, "2026-08-01")).toEqual({
      dueDate: "2026-08-01",
      inherits: true,
    });
    expect(resolveEffectiveSubKpiDueDate({}, null)).toEqual({
      dueDate: null,
      inherits: true,
    });
  });

  it("exposes inheritance on REST DTOs", () => {
    const raw = {
      segmented: false,
      items: [
        { id: "a", title: "Custom", dueDate: "2026-09-10", done: false },
        { id: "b", title: "Inherit", done: false },
      ],
      pillarDueDate: "2026-08-15",
    };
    const dtos = listSubTaskDtos(raw);
    expect(dtos[0]).toMatchObject({
      dueDate: "2026-09-10",
      effectiveDueDate: "2026-09-10",
      inheritsDueDate: false,
    });
    expect(dtos[1]).toMatchObject({
      dueDate: null,
      effectiveDueDate: "2026-08-15",
      inheritsDueDate: true,
    });
  });
});
