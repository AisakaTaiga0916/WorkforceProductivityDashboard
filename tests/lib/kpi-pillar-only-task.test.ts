import { describe, expect, it } from "vitest";
import {
  applyPillarOnlyTaskCreate,
  collectChecklistProgressItems,
  isPillarOnlyTask,
  kpiChecklistProgress,
  markEverySubKpiDone,
  PILLAR_ONLY_VIRTUAL_SUBKPI_ID,
  pillarVirtualSubKpiItem,
  resetAllSubKpiDone,
  setPillarWorkMeta,
  setSubKpiItemDone,
  syncPillarDoneFromRequirements,
} from "@/modules/tasks/kpi-subkpis";
import { subKpiRequirementsMet } from "@/modules/tasks/sub-kpi-completion-mode";

describe("pillar-only tasks", () => {
  it("creates an empty checklist with pillar completion requirements", () => {
    const raw = applyPillarOnlyTaskCreate(
      { segmented: false, items: [] },
      { checkbox: true, screenshots: false, screenshotUpload: false, numerical: false },
      { dueDate: "2026-06-15" },
    );

    expect(isPillarOnlyTask(raw)).toBe(true);
    const virtual = pillarVirtualSubKpiItem(raw, "Server maintenance");
    expect(virtual?.id).toBe(PILLAR_ONLY_VIRTUAL_SUBKPI_ID);
    expect(virtual?.dueDate).toBe("2026-06-15");
    expect(virtual?.done).toBe(false);
  });

  it("tracks progress from the virtual pillar row", () => {
    let raw = applyPillarOnlyTaskCreate(
      { segmented: false, items: [] },
      { checkbox: true, screenshots: false, screenshotUpload: false, numerical: false },
    );
    expect(kpiChecklistProgress(raw, "Ops")).toEqual({
      total: 1,
      done: 0,
      missing: 1,
      percent: 0,
    });

    raw = setSubKpiItemDone(raw, PILLAR_ONLY_VIRTUAL_SUBKPI_ID, true);
    // The virtual row carries no per-item verification fields, so progress only
    // counts it once the card is verified or platform verification is off.
    expect(kpiChecklistProgress(raw, "Ops", { verificationEnabled: false })).toEqual({
      total: 1,
      done: 1,
      missing: 0,
      percent: 100,
    });
    expect(kpiChecklistProgress(raw, "Ops", { parentCardEffectivelyVerified: true }).done).toBe(1);
  });

  it("markAllDone toggles pillar completion", () => {
    const raw = applyPillarOnlyTaskCreate(
      { segmented: false, items: [] },
      { checkbox: true, screenshots: false, screenshotUpload: false, numerical: false },
    );
    const done = markEverySubKpiDone(raw, true);
    const virtual = pillarVirtualSubKpiItem(done);
    expect(virtual?.done).toBe(true);
    expect(subKpiRequirementsMet(virtual!)).toBe(true);
  });

  it("syncs pillar done when numerical record reaches target", () => {
    let raw = applyPillarOnlyTaskCreate(
      { segmented: false, items: [] },
      { checkbox: false, screenshots: false, screenshotUpload: false, numerical: true },
      { numericalTarget: 100 },
    );
    raw = setPillarWorkMeta(raw, { numericalValue: 100 });
    raw = syncPillarDoneFromRequirements(raw);
    const virtual = pillarVirtualSubKpiItem(raw);
    expect(virtual?.done).toBe(true);
    expect(collectChecklistProgressItems(raw)[0]?.done).toBe(true);
  });

  it("supports recurring pillar-only tasks without an initial numerical target", () => {
    const raw = applyPillarOnlyTaskCreate(
      { segmented: false, items: [] },
      { checkbox: true, screenshots: false, screenshotUpload: false, numerical: true },
    );
    expect(isPillarOnlyTask(raw)).toBe(true);
    const virtual = pillarVirtualSubKpiItem(raw, "Daily backup");
    expect(virtual?.numericalTarget).toBeUndefined();
    expect(kpiChecklistProgress(raw, "Daily backup").total).toBe(1);
  });

  it("resets pillar completion on recurring cycle rollover", () => {
    let raw = applyPillarOnlyTaskCreate(
      { segmented: false, items: [] },
      { checkbox: true, screenshots: false, screenshotUpload: false, numerical: false },
    );
    raw = markEverySubKpiDone(raw, true);
    const reset = resetAllSubKpiDone(raw);
    const virtual = pillarVirtualSubKpiItem(reset);
    expect(virtual?.done).toBe(false);
    expect(kpiChecklistProgress(reset).done).toBe(0);
  });
});
