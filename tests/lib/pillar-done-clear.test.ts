import { describe, expect, it } from "vitest";
import {
  applyPillarOnlyTaskCreate,
  kpiChecklistMetricView,
  kpiChecklistProgress,
  setPillarDone,
  wrapForPersist,
} from "@/modules/tasks/kpi-subkpis";

describe("setPillarDone", () => {
  it("clears a previously flagged pillar-only inverted task", () => {
    let raw = applyPillarOnlyTaskCreate(
      wrapForPersist({ segmented: false, flat: [] }),
      { checkbox: true, numerical: false, screenshots: false, screenshotUpload: false },
    );
    raw = setPillarDone(raw, true);
    expect((raw as { pillarDone?: boolean }).pillarDone).toBe(true);
    expect(
      kpiChecklistProgress(raw, "CYBERSECURITY", { verificationEnabled: false }).done,
    ).toBe(1);

    raw = setPillarDone(raw, false);
    expect((raw as { pillarDone?: boolean }).pillarDone).toBeUndefined();
    const prog = kpiChecklistProgress(raw, "CYBERSECURITY", { verificationEnabled: false });
    expect(prog.done).toBe(0);
    expect(prog.missing).toBe(1);
    const view = kpiChecklistMetricView(prog, true);
    expect(view.negative).toBe(0);
    expect(view.positive).toBe(1);
    expect(view.percent).toBe(100);
  });
});
