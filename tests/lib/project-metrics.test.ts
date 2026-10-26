import { describe, expect, it } from "vitest";
import {
  isProjectAtRisk,
  isProjectPhaseComplete,
  isProjectPhaseDelayed,
} from "@/modules/projects/project-metrics";

const TODAY = "2026-10-19";

describe("project metrics", () => {
  it("treats a phase as complete only when it has items and all are done", () => {
    expect(isProjectPhaseComplete({ dueDate: null, items: [] })).toBe(false);
    expect(
      isProjectPhaseComplete({ dueDate: null, items: [{ status: "DONE", dueDate: null }] }),
    ).toBe(true);
  });

  it("flags phases past target with open work", () => {
    const late = { dueDate: "2026-10-01", items: [{ status: "ON_GOING", dueDate: null }] };
    expect(isProjectPhaseDelayed(late, TODAY)).toBe(true);
    expect(isProjectPhaseDelayed({ ...late, dueDate: TODAY }, TODAY)).toBe(false);
    expect(
      isProjectPhaseDelayed({ dueDate: "2026-10-01", items: [{ status: "DONE", dueDate: null }] }, TODAY),
    ).toBe(false);
  });

  it("marks open projects at risk for late target, phase, or item", () => {
    const base = { status: "ON_GOING", dueDate: "2026-12-01", phases: [] };
    expect(isProjectAtRisk(base, TODAY)).toBe(false);
    expect(isProjectAtRisk({ ...base, dueDate: "2026-10-18" }, TODAY)).toBe(true);
    expect(
      isProjectAtRisk(
        { ...base, phases: [{ dueDate: null, items: [{ status: "PENDING", dueDate: "2026-10-10" }] }] },
        TODAY,
      ),
    ).toBe(true);
    expect(isProjectAtRisk({ ...base, status: "DONE", dueDate: "2026-01-01" }, TODAY)).toBe(false);
  });
});
