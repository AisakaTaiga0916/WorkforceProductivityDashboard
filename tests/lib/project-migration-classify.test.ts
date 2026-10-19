import { describe, expect, it } from "vitest";
import {
  classifyKpiRowForProjects,
  projectMigrationSignals,
} from "@/modules/projects/project-migration-classify";

const task = { title: "PAYROLL", isRecurring: true, subKpis: {} };

describe("projectMigrationSignals", () => {
  it("detects envelope, flag, JO link, and column signals", () => {
    const signals = projectMigrationSignals({
      title: "WEBSITE REBUILD",
      isRecurring: false,
      itProjectName: "Website",
      subKpis: {
        kind: "it_project",
        isProject: true,
        linkedJobOrderTicketId: "ticket-1",
        phases: [],
      },
    });
    expect(signals).toEqual([
      "it_project_envelope",
      "is_project_flag",
      "linked_job_order",
      "it_project_name",
    ]);
  });

  it("detects pillar titles and field assignments", () => {
    expect(projectMigrationSignals({ ...task, title: "IT PROJECT IMPLEMENTATION" })).toEqual([
      "it_pillar_title",
    ]);
    expect(projectMigrationSignals({ ...task, title: "JOB ORDER REQUEST" })).toEqual([
      "jo_request_pillar",
    ]);
    expect(
      projectMigrationSignals({
        title: "CAMERA INSTALLATION",
        isRecurring: false,
        subKpis: { isFieldAssignment: true },
      }),
    ).toEqual(["field_assignment"]);
  });
});

describe("classifyKpiRowForProjects", () => {
  it("keeps plain recurring rows as tasks", () => {
    expect(classifyKpiRowForProjects(task).classification).toBe("TASK");
  });

  it("keeps field assignments as tasks", () => {
    const result = classifyKpiRowForProjects({
      title: "CAMERA INSTALLATION",
      isRecurring: false,
      subKpis: { isFieldAssignment: true },
    });
    expect(result.classification).toBe("TASK");
  });

  it("classifies timeline envelopes as projects", () => {
    const result = classifyKpiRowForProjects({
      title: "WEBSITE REBUILD",
      isRecurring: false,
      subKpis: { kind: "it_project", phases: [{ id: "p1", name: "Phase 1", items: [] }] },
    });
    expect(result.classification).toBe("PROJECT");
  });

  it("classifies legacy pillar and JO rows as projects", () => {
    expect(
      classifyKpiRowForProjects({ ...task, title: "IT PROJECT IMPLEMENTATION", isRecurring: false })
        .classification,
    ).toBe("PROJECT");
    expect(
      classifyKpiRowForProjects({ ...task, title: "JOB ORDER REQUEST", isRecurring: false })
        .classification,
    ).toBe("PROJECT");
  });

  it("classifies envelope JO links as projects", () => {
    const result = classifyKpiRowForProjects({
      title: "FIBER RUN",
      isRecurring: false,
      subKpis: { linkedJobOrderTicketId: "ticket-9" },
    });
    expect(result.classification).toBe("PROJECT");
  });

  it("exception: project signals on a recurring row", () => {
    const result = classifyKpiRowForProjects({
      title: "WEBSITE REBUILD",
      isRecurring: true,
      subKpis: { kind: "it_project" },
    });
    expect(result.classification).toBe("EXCEPTION");
    expect(result.reason).toContain("recurring");
  });

  it("exception: project flag without timeline envelope", () => {
    const result = classifyKpiRowForProjects({
      title: "WEBSITE REBUILD",
      isRecurring: false,
      subKpis: { isProject: true },
    });
    expect(result.classification).toBe("EXCEPTION");
    expect(result.reason).toContain("synthesized");
  });

  it("exception: field assignment mixed with project signals", () => {
    const result = classifyKpiRowForProjects({
      title: "CAMERA INSTALLATION",
      isRecurring: false,
      subKpis: { isFieldAssignment: true, isProject: true, kind: "it_project" },
    });
    expect(result.classification).toBe("EXCEPTION");
    expect(result.reason).toContain("Field assignment");
  });
});
