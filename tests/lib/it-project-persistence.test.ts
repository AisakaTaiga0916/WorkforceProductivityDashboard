import { describe, expect, it } from "vitest";
import {
  buildItProjectFromPhaseDrafts,
  isItProjectEnvelope,
  isTimelineProjectKpi,
  parseItProjectSubKpis,
  setItProjectSubKpiAssignee,
  setItProjectSubKpiLifecycle,
  setItProjectSubKpiTitle,
  wrapItProjectSubKpis,
} from "@/lib/it-project-subkpis";
import { setTaskCount, ensureEnvelope } from "@/lib/kpi-subkpis";

describe("IT project create persistence", () => {
  it("preserves phases through setTaskCount / ensureEnvelope", () => {
    const built = buildItProjectFromPhaseDrafts([
      {
        name: "Discovery",
        dueDate: "2026-08-01",
        items: [
          { title: "Kickoff", dueDate: "2026-07-20" },
          { title: "Requirements", dueDate: "2026-07-25" },
        ],
      },
      {
        name: "Build",
        dueDate: "2026-09-01",
        items: [{ title: "Implement", dueDate: "2026-08-15" }],
      },
    ]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const wrapped = wrapItProjectSubKpis(built.data);
    expect(isItProjectEnvelope(wrapped)).toBe(true);

    const withCount = setTaskCount(wrapped, 3);
    expect(isItProjectEnvelope(withCount)).toBe(true);
    const parsed = parseItProjectSubKpis(withCount);
    expect(parsed.phases).toHaveLength(2);
    expect(parsed.phases[0]!.items).toHaveLength(2);
    expect(parsed.phases[0]!.dueDate).toBe("2026-08-01");
    expect(parsed.phases[1]!.items[0]!.title).toBe("Implement");

    const ensured = ensureEnvelope(withCount);
    expect(isItProjectEnvelope(ensured)).toBe(true);
    expect(parseItProjectSubKpis(ensured).phases[0]!.items).toHaveLength(2);
  });

  it("renames a timeline project subtask title", () => {
    const built = buildItProjectFromPhaseDrafts([
      {
        name: "Discovery",
        dueDate: "2026-08-01",
        items: [{ title: "Kickoff", dueDate: "2026-07-20" }],
      },
    ]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const wrapped = wrapItProjectSubKpis(built.data);
    const itemId = built.data.phases[0]!.items[0]!.id;
    const renamed = setItProjectSubKpiTitle(wrapped, itemId, "  Kickoff revised  ");
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(parseItProjectSubKpis(renamed.json).phases[0]!.items[0]!.title).toBe(
      "Kickoff revised",
    );
    expect(setItProjectSubKpiTitle(wrapped, itemId, "   ").ok).toBe(false);
    expect(setItProjectSubKpiTitle(wrapped, "missing", "Nope").ok).toBe(false);
  });

  it("sets phase due from latest subtask due (allows subtask after draft phase due)", () => {
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

  it("start/end lifecycle updates dates and status", () => {
    const built = buildItProjectFromPhaseDrafts([
      {
        name: "Phase 1",
        items: [{ title: "Work", dueDate: "2026-12-31" }],
      },
    ]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const id = built.data.phases[0]!.items[0]!.id;
    const started = setItProjectSubKpiLifecycle(wrapItProjectSubKpis(built.data), id, "start");
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const afterStart = parseItProjectSubKpis(started.json).phases[0]!.items[0]!;
    expect(afterStart.startDate).toBeTruthy();
    expect(afterStart.projectStatus).toBe("On Going");

    const ended = setItProjectSubKpiLifecycle(started.json, id, "end");
    expect(ended.ok).toBe(true);
    if (!ended.ok) return;
    const afterEnd = parseItProjectSubKpis(ended.json).phases[0]!.items[0]!;
    expect(afterEnd.actualDate).toBeTruthy();
    expect(afterEnd.done).toBe(true);
    expect(afterEnd.projectStatus).toBe("Done");
  });

  it("assigns a helper on a custom-title timeline project (not IT PROJECT IMPLEMENTATION title)", () => {
    const built = buildItProjectFromPhaseDrafts([
      {
        name: "Phase 1",
        dueDate: "2026-12-31",
        items: [
          { title: "SD", dueDate: "2026-12-15" },
          { title: "MM", dueDate: "2026-12-20" },
        ],
      },
    ]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const wrapped = wrapItProjectSubKpis(built.data);
    expect(isTimelineProjectKpi("AGCTEK ERP", wrapped)).toBe(true);
    expect(isTimelineProjectKpi("IT PROJECT IMPLEMENTATION", wrapped)).toBe(true);
    expect(isTimelineProjectKpi("MONITORING", { segmented: false, items: [] })).toBe(false);

    const subId = built.data.phases[0]!.items[0]!.id;
    const next = setItProjectSubKpiAssignee(wrapped, subId, { id: "agent-1", name: "Helper" });
    const item = parseItProjectSubKpis(next).phases[0]!.items[0]!;
    expect(item.assignedAgentId).toBe("agent-1");
    expect(item.assignedAgentName).toBe("Helper");
    expect(item.projectStatus).toBe("Pending");
  });
});
