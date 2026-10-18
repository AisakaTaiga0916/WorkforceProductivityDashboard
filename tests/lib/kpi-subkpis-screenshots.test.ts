import { describe, expect, it } from "vitest";
import {
  getArchivedNumericalRecords,
  getArchivedTaskScreenshots,
  getPillarScreenshots,
  normalizeSubKpis,
  pillarScreenshotUploadEnabled,
  removePillarScreenshot,
  removeSubKpiItemScreenshot,
  resetAllSubKpiDone,
  setSubKpiItemScreenshots,
  setPillarScreenshotUploads,
} from "@/modules/tasks/kpi-subkpis";

const screenshot = {
  storedFileName: "proof-1.png",
  originalName: "proof.png",
  mimeType: "image/png" as const,
  size: 1234,
  uploadedAt: "2026-05-26T00:00:00.000Z",
};

describe("KPI task screenshots", () => {
  it("archives uploaded screenshots and clears active slots when recurring tasks reset", () => {
    const reset = resetAllSubKpiDone({
      segmented: false,
      items: [
        {
          id: "sub-1",
          title: "Daily check",
          done: true,
          screenshotsEnabled: true,
          beforeScreenshot: [screenshot],
          afterScreenshot: [{ ...screenshot, storedFileName: "proof-2.png" }],
        },
      ],
      pillarScreenshotsEnabled: true,
      pillarBeforeScreenshot: [screenshot],
    });

    const normalized = normalizeSubKpis(reset);
    expect(normalized.segmented).toBe(false);
    if (normalized.segmented) throw new Error("Expected flat sub-task list");
    const [item] = normalized.flat;

    expect(item.done).toBe(false);
    expect(item.beforeScreenshot).toBeUndefined();
    expect(item.afterScreenshot).toBeUndefined();
    expect(getPillarScreenshots(reset, "before")).toEqual([]);

    const [archive] = getArchivedTaskScreenshots(reset);
    expect(archive?.subTasks[0]?.beforeScreenshot?.[0]?.storedFileName).toBe("proof-1.png");
    expect(archive?.subTasks[0]?.afterScreenshot?.[0]?.storedFileName).toBe("proof-2.png");
    expect(archive?.pillarBeforeScreenshot?.[0]?.storedFileName).toBe("proof-1.png");
  });

  it("archives numerical records and clears actual while preserving target on cycle reset", () => {
    const reset = resetAllSubKpiDone({
      segmented: false,
      items: [
        {
          id: "sub-1",
          title: "Sales count",
          done: true,
          completionRequirements: { checkbox: true, screenshots: false, numerical: true },
          numericalTarget: 100,
          numericalValue: 85,
        },
      ],
    });

    const normalized = normalizeSubKpis(reset);
    if (normalized.segmented) throw new Error("Expected flat sub-task list");
    const [item] = normalized.flat;

    expect(item.done).toBe(false);
    // Target carries into the next period; only the actual is cleared.
    expect(item.numericalTarget).toBe(100);
    expect(item.numericalValue).toBeUndefined();

    const archives = getArchivedNumericalRecords(reset);
    expect(archives).toHaveLength(1);
    expect(archives[0]?.subTasks[0]).toMatchObject({
      id: "sub-1",
      numericalTarget: 100,
      numericalValue: 85,
    });
  });

  it("stores generic screenshot uploads on sub-tasks", () => {
    const updated = setSubKpiItemScreenshots(
      {
        segmented: false,
        items: [
          {
            id: "sub-1",
            title: "Proof row",
            completionRequirements: { checkbox: true, screenshots: false, screenshotUpload: true, numerical: false },
          },
        ],
      },
      "sub-1",
      "general",
      [screenshot],
    );

    const normalized = normalizeSubKpis(updated);
    const item = normalized.segmented ? null : normalized.flat[0];
    expect(item?.uploadScreenshot?.[0]?.storedFileName).toBe("proof-1.png");
  });

  it("removes a selected sub-task screenshot without clearing the other slot", () => {
    const updated = removeSubKpiItemScreenshot(
      {
        segmented: false,
        items: [
          {
            id: "sub-1",
            title: "Daily check",
            screenshotsEnabled: true,
            beforeScreenshot: [screenshot, { ...screenshot, storedFileName: "proof-keep.png" }],
            afterScreenshot: [{ ...screenshot, storedFileName: "proof-after.png" }],
          },
        ],
      },
      "sub-1",
      "before",
      "proof-1.png",
    );

    const normalized = normalizeSubKpis(updated);
    const item = normalized.segmented ? null : normalized.flat[0];

    expect(item?.beforeScreenshot?.map((m) => m.storedFileName)).toEqual(["proof-keep.png"]);
    expect(item?.afterScreenshot?.map((m) => m.storedFileName)).toEqual(["proof-after.png"]);
  });

  it("removes a selected pillar screenshot", () => {
    const updated = removePillarScreenshot(
      {
        segmented: false,
        items: [],
        pillarScreenshotsEnabled: true,
        pillarBeforeScreenshot: [screenshot, { ...screenshot, storedFileName: "proof-keep.png" }],
      },
      "before",
      "proof-1.png",
    );

    expect(getPillarScreenshots(updated, "before").map((m) => m.storedFileName)).toEqual(["proof-keep.png"]);
  });

  it("stores generic pillar screenshot uploads separately from before/after", () => {
    const updated = setPillarScreenshotUploads({ segmented: false, items: [] }, [screenshot]);

    expect(pillarScreenshotUploadEnabled(updated)).toBe(true);
    expect(getPillarScreenshots(updated, "general")).toEqual([screenshot]);
    expect(getPillarScreenshots(updated, "before")).toEqual([]);
  });
});
