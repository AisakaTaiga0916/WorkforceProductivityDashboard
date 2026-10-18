import { describe, expect, it } from "vitest";
import { kpiHasDistinctMainTask, kpiMainTaskLabel, kpiPillarLabel } from "@/modules/tasks/kpi-main-task";

describe("kpi main task labels", () => {
  it("uses mainTask when set", () => {
    expect(kpiMainTaskLabel({ title: "NETWORK MAINTENANCE", mainTask: "Reroute Connections" })).toBe(
      "Reroute Connections",
    );
    expect(kpiHasDistinctMainTask({ title: "NETWORK MAINTENANCE", mainTask: "Reroute Connections" })).toBe(
      true,
    );
  });

  it("falls back to pillar title for legacy rows", () => {
    expect(kpiMainTaskLabel({ title: "NETWORK MAINTENANCE", mainTask: null })).toBe("NETWORK MAINTENANCE");
    expect(kpiHasDistinctMainTask({ title: "NETWORK MAINTENANCE", mainTask: null })).toBe(false);
  });

  it("returns pillar label from title", () => {
    expect(kpiPillarLabel({ title: "NETWORK MAINTENANCE" })).toBe("NETWORK MAINTENANCE");
  });
});
