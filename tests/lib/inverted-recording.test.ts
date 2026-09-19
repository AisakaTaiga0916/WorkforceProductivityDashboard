import { describe, expect, it } from "vitest";
import {
  invertedContributorItemCredited,
  invertedRecordingPeriodClear,
  kpiChecklistProgress,
  kpiInvertedRawProgress,
  kpiSnapshotProgress,
  progressWithInvertedRecording,
  setInvertedRecording,
  taskUsesInvertedRecording,
} from "@/lib/kpi-subkpis";

describe("inverted recording", () => {
  it("treats unchecked items as 100% and lowers percent when checked", () => {
    const raw = setInvertedRecording(
      {
        segmented: false,
        items: [
          { id: "a", title: "Incident A", done: false },
          { id: "b", title: "Incident B", done: false },
          { id: "c", title: "Incident C", done: false },
        ],
      },
      true,
    );
    expect(taskUsesInvertedRecording({ title: "Network", subKpis: raw })).toBe(true);

    const clear = kpiChecklistProgress(raw, "Network");
    expect(progressWithInvertedRecording(clear, true).percent).toBe(100);

    const withFlags = setInvertedRecording(
      {
        segmented: false,
        items: [
          { id: "a", title: "Incident A", done: true },
          { id: "b", title: "Incident B", done: false },
          { id: "c", title: "Incident C", done: true },
        ],
      },
      true,
    );
    const flagged = kpiInvertedRawProgress(withFlags, "Network");
    expect(progressWithInvertedRecording(flagged, true).percent).toBe(33);
  });

  it("stores snapshot progress with no missing items when all incidents are clear", () => {
    const raw = setInvertedRecording(
      {
        segmented: false,
        items: [
          { id: "a", title: "Incident A", done: false },
          { id: "b", title: "Incident B", done: false },
        ],
      },
      true,
    );
    const row = { title: "CYBERSECURITY", mainTask: "Daily scan", subKpis: raw };
    const snapshot = kpiSnapshotProgress(row, "Daily scan");
    expect(snapshot.done).toBe(2);
    expect(snapshot.missing).toBe(0);
    expect(snapshot.percent).toBe(100);
    expect(invertedRecordingPeriodClear(row, "Daily scan")).toBe(true);
    expect(invertedContributorItemCredited({ id: "a", title: "A", done: false })).toBe(true);
    expect(invertedContributorItemCredited({ id: "a", title: "A", done: true })).toBe(false);
  });

  it("marks flagged incidents as missing in snapshot progress after cadence reset", () => {
    const raw = setInvertedRecording(
      {
        segmented: false,
        items: [
          { id: "a", title: "Incident A", done: true },
          { id: "b", title: "Incident B", done: false },
        ],
      },
      true,
    );
    const row = { title: "NETWORK PERFORMANCE", mainTask: "Uptime", subKpis: raw };
    const snapshot = kpiSnapshotProgress(row, "Uptime");
    expect(snapshot.done).toBe(1);
    expect(snapshot.missing).toBe(1);
    expect(snapshot.percent).toBe(50);
    expect(invertedRecordingPeriodClear(row, "Uptime")).toBe(false);
  });
});
