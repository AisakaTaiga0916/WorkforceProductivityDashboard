import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  completeJobOrderApprovalStep,
  defaultJobOrderApprovalMeta,
  jobOrderApprovalStartStep,
  jobOrderApprovalStepsFor,
  nextJobOrderApprovalStep,
  parseJobOrderApprovalMeta,
} from "../../src/lib/job-order-approval";

describe("Job Order skip Noted By / Approved By", () => {
  it("computes start step from skip flags", () => {
    assert.equal(jobOrderApprovalStartStep(false, false), "NOTED_BY");
    assert.equal(jobOrderApprovalStartStep(true, false), "APPROVED_BY");
    assert.equal(jobOrderApprovalStartStep(false, true), "NOTED_BY");
    assert.equal(jobOrderApprovalStartStep(true, true), "APPROVED_BY_2");
  });

  it("filters procedural steps for skipped seats", () => {
    assert.deepEqual(jobOrderApprovalStepsFor({ skipNotedBy: true }), [
      "APPROVED_BY",
      "APPROVED_BY_2",
    ]);
    assert.deepEqual(jobOrderApprovalStepsFor({ skipApprovedBy: true }), [
      "NOTED_BY",
      "APPROVED_BY_2",
    ]);
    assert.deepEqual(jobOrderApprovalStepsFor({ skipNotedBy: true, skipApprovedBy: true }), [
      "APPROVED_BY_2",
    ]);
  });

  it("parses skip flags from stored meta", () => {
    const meta = parseJobOrderApprovalMeta({
      preparedByAgentId: null,
      notedByAgentId: null,
      approvedByAgentId: "a2",
      approvedBy2AgentId: "a3",
      proceduralStep: "APPROVED_BY",
      completed: {},
      skipNotedBy: true,
      skipApprovedBy: false,
    });
    assert.equal(meta?.skipNotedBy, true);
    assert.equal(meta?.skipApprovedBy, false);
    assert.equal(meta?.proceduralStep, "APPROVED_BY");
  });

  it("defaults meta with skipNotedBy starting at Approved By", () => {
    const meta = defaultJobOrderApprovalMeta({ skipNotedBy: true });
    assert.equal(meta.skipNotedBy, true);
    assert.equal(meta.proceduralStep, "APPROVED_BY");
  });

  it("advances past skipped Approved By after Noted By", () => {
    let meta = defaultJobOrderApprovalMeta({ skipApprovedBy: true });
    meta = {
      ...meta,
      notedByAgentId: "n1",
      approvedBy2AgentId: "hr1",
    };
    assert.equal(nextJobOrderApprovalStep("NOTED_BY", meta), "APPROVED_BY_2");
    const advanced = completeJobOrderApprovalStep(meta);
    assert.equal(advanced.proceduralStep, "APPROVED_BY_2");
    assert.ok(advanced.completed.NOTED_BY);
  });

  it("completes from skipNotedBy start through remaining seats", () => {
    let meta = defaultJobOrderApprovalMeta({ skipNotedBy: true });
    meta = {
      ...meta,
      approvedByAgentId: "a1",
      approvedBy2AgentId: "hr1",
    };
    meta = completeJobOrderApprovalStep(meta);
    assert.equal(meta.proceduralStep, "APPROVED_BY_2");
    meta = completeJobOrderApprovalStep(meta);
    assert.equal(meta.proceduralStep, "DONE");
  });
});
