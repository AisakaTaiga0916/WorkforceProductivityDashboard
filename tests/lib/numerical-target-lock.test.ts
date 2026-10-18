import { describe, expect, it } from "vitest";
import {
  canAdjustNumericalTarget,
  hasRecurredNumericalCycle,
  normalizeSubKpis,
  resetAllSubKpiDone,
  wrapForPersist,
} from "@/modules/tasks/kpi-subkpis";

describe("numerical target while task is running", () => {
  const flatWithTarget = wrapForPersist({
    segmented: false as const,
    flat: [
      {
        id: "n1",
        title: "Count widgets",
        done: false,
        completionRequirements: {
          checkbox: false,
          screenshots: false,
          screenshotUpload: false,
          numerical: true,
        },
        numericalTarget: 100,
        numericalValue: 40,
      },
    ],
  });

  it("allows setting or changing the target while the task is running", () => {
    expect(
      canAdjustNumericalTarget({
        isRecurring: false,
        subKpisRaw: flatWithTarget,
        subKpiId: "n1",
      }),
    ).toBe(true);
    expect(
      canAdjustNumericalTarget({
        isRecurring: true,
        subKpisRaw: flatWithTarget,
        subKpiId: "n1",
      }),
    ).toBe(true);
    expect(hasRecurredNumericalCycle(flatWithTarget)).toBe(false);
  });

  it("still detects archived cycles after rollover", () => {
    const withArchive = {
      ...(flatWithTarget as Record<string, unknown>),
      archivedNumericalRecords: [
        {
          archivedAt: "2026-01-01T00:00:00.000Z",
          subTasks: [{ id: "n1", title: "Count widgets", numericalTarget: 100, numericalValue: 40 }],
        },
      ],
    };
    expect(hasRecurredNumericalCycle(withArchive)).toBe(true);
    expect(
      canAdjustNumericalTarget({
        isRecurring: true,
        subKpisRaw: withArchive,
        subKpiId: "n1",
      }),
    ).toBe(true);
  });

  it("preserves numericalTarget across cycle reset while clearing actual", () => {
    const afterReset = resetAllSubKpiDone(flatWithTarget);
    const n = normalizeSubKpis(afterReset);
    if (n.segmented) throw new Error("expected flat sub-kpis");
    const item = n.flat[0]!;
    expect(item.numericalTarget).toBe(100);
    expect(item.numericalValue).toBeUndefined();
    expect(hasRecurredNumericalCycle(afterReset)).toBe(true);
  });
});
