import { describe, expect, it } from "vitest";
import { kpiChecklistProgress } from "@/modules/tasks/kpi-subkpis";
import {
  numericalRecordProgressPercent,
  subKpiItemProgressFraction,
} from "@/modules/tasks/sub-kpi-completion-mode";

describe("numericalRecordProgressPercent", () => {
  it("computes (actual / target) * 100 rounded", () => {
    expect(numericalRecordProgressPercent(50, 100)).toBe(50);
    expect(numericalRecordProgressPercent(75, 100)).toBe(75);
    expect(numericalRecordProgressPercent(120, 100)).toBe(120);
    expect(numericalRecordProgressPercent(null, 100)).toBe(0);
  });

  it("returns null when target is missing or zero", () => {
    expect(numericalRecordProgressPercent(50, null)).toBeNull();
    expect(numericalRecordProgressPercent(50, 0)).toBeNull();
  });
});

describe("subKpiItemProgressFraction", () => {
  it("uses numerical progress when only numerical completion is enabled", () => {
    expect(
      subKpiItemProgressFraction({
        done: false,
        completionRequirements: { checkbox: false, screenshots: false, screenshotUpload: false, numerical: true },
        numericalTarget: 200,
        numericalValue: 100,
      }),
    ).toBe(0.5);
  });
});

describe("kpiChecklistProgress with numerical sub-tasks", () => {
  it("reflects partial numerical progress in checklist percent", () => {
    const progress = kpiChecklistProgress({
      segmented: false,
      items: [
        {
          id: "a",
          title: "Metric A",
          done: false,
          completionRequirements: { checkbox: false, screenshots: false, screenshotUpload: false, numerical: true },
          numericalTarget: 100,
          numericalValue: 40,
        },
      ],
    });
    expect(progress.percent).toBe(40);
    expect(progress.done).toBe(0);
  });
});
