import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { totalRecordedDataPercent } from "../../src/modules/tasks/sub-kpi-completion-mode";
import type { SubKpiItem } from "../../src/modules/tasks/kpi-subkpis";

function item(
  partial: Partial<SubKpiItem> & Pick<SubKpiItem, "id" | "title">,
): SubKpiItem {
  return {
    done: false,
    ...partial,
  };
}

describe("totalRecordedDataPercent", () => {
  it("returns null when no numerical targets are present", () => {
    assert.equal(
      totalRecordedDataPercent([
        item({ id: "1", title: "A", done: true }),
        item({ id: "2", title: "B", done: false }),
      ]),
      null,
    );
  });

  it("sums actual over target across numerical sub-tasks", () => {
    const pct = totalRecordedDataPercent([
      item({
        id: "1",
        title: "A",
        completionRequirements: { checkbox: false, screenshots: false, screenshotUpload: false, numerical: true },
        numericalTarget: 100,
        numericalValue: 40,
      }),
      item({
        id: "2",
        title: "B",
        completionRequirements: { checkbox: false, screenshots: false, screenshotUpload: false, numerical: true },
        numericalTarget: 100,
        numericalValue: 80,
      }),
    ]);
    assert.equal(pct, 60);
  });

  it("counts missing actuals as zero toward the total", () => {
    const pct = totalRecordedDataPercent([
      item({
        id: "1",
        title: "A",
        completionRequirements: { checkbox: false, screenshots: false, screenshotUpload: false, numerical: true },
        numericalTarget: 50,
      }),
      item({
        id: "2",
        title: "B",
        completionRequirements: { checkbox: false, screenshots: false, screenshotUpload: false, numerical: true },
        numericalTarget: 50,
        numericalValue: 50,
      }),
    ]);
    assert.equal(pct, 50);
  });
});
