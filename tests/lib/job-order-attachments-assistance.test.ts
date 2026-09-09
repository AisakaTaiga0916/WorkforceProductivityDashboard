import { describe, expect, it } from "vitest";
import {
  canCompleteJobOrderApprovalStep,
  defaultJobOrderApprovalMeta,
  isJobOrderCurrentStepLastApprover,
  isJobOrderExecutionWorkspaceOpen,
} from "@/lib/job-order-approval";
import {
  hasJobOrderJobOutputUploaded,
  partitionJobOrderAttachments,
} from "@/lib/job-order-attachments";
import { isJobOrderExecutionOutsideSendToDepartment } from "@/lib/job-order-assistance-scope";
import type { IntakeScreenshotMetaItem } from "@/lib/ticket-intake-screenshots-meta";

function file(partial: Partial<IntakeScreenshotMetaItem>): IntakeScreenshotMetaItem {
  return {
    storedFileName: partial.storedFileName ?? "a.png",
    originalName: partial.originalName ?? "a.png",
    mimeType: partial.mimeType ?? "image/png",
    size: partial.size ?? 10,
    section: partial.section,
    uploadedByAgentId: partial.uploadedByAgentId,
    uploadedAt: partial.uploadedAt,
  };
}

describe("job order attachment sections", () => {
  it("treats untagged intake files as planning", () => {
    const parts = partitionJobOrderAttachments([
      file({ storedFileName: "1.png" }),
      file({ storedFileName: "2.png", section: "job_output" }),
      file({ storedFileName: "3.png", section: "planning" }),
    ]);
    expect(parts.planning.map((f) => f.storedFileName)).toEqual(["1.png", "3.png"]);
    expect(parts.jobOutput.map((f) => f.storedFileName)).toEqual(["2.png"]);
    expect(hasJobOrderJobOutputUploaded(parts.planning.concat(parts.jobOutput))).toBe(true);
  });
});

describe("job order last-approver Job Output gate", () => {
  it("blocks final Done without Job Done, then without Job Output", () => {
    const meta = {
      ...defaultJobOrderApprovalMeta(),
      proceduralStep: "APPROVED_BY_2" as const,
      approvedBy2AgentId: "approver",
      completed: {
        NOTED_BY: new Date().toISOString(),
        APPROVED_BY: new Date().toISOString(),
      },
    };
    expect(isJobOrderCurrentStepLastApprover(meta)).toBe(true);
    expect(isJobOrderExecutionWorkspaceOpen(meta)).toBe(true);
    const needsJobDone = canCompleteJobOrderApprovalStep({
      meta,
      actorAgentId: "approver",
      ticketAssignedAgentId: "approver",
      hasJobOutput: true,
      hasJobDone: false,
    });
    expect(needsJobDone.ok).toBe(false);
    if (!needsJobDone.ok) {
      expect(needsJobDone.error).toMatch(/Job Done/i);
    }
    const blocked = canCompleteJobOrderApprovalStep({
      meta,
      actorAgentId: "approver",
      ticketAssignedAgentId: "approver",
      hasJobOutput: false,
      hasJobDone: true,
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.error).toMatch(/Job Output/i);
    }
    const allowed = canCompleteJobOrderApprovalStep({
      meta,
      actorAgentId: "approver",
      ticketAssignedAgentId: "approver",
      hasJobOutput: true,
      hasJobDone: true,
    });
    expect(allowed.ok).toBe(true);
  });

  it("does not require Job Output for earlier seats", () => {
    const meta = {
      ...defaultJobOrderApprovalMeta(),
      proceduralStep: "NOTED_BY" as const,
      notedByAgentId: "noter",
    };
    const gate = canCompleteJobOrderApprovalStep({
      meta,
      actorAgentId: "noter",
      ticketAssignedAgentId: "noter",
      hasJobOutput: false,
    });
    expect(gate.ok).toBe(true);
  });
});

describe("job order assistance scope", () => {
  it("flags execution assignee outside send-to department", () => {
    expect(
      isJobOrderExecutionOutsideSendToDepartment({
        executionAssigneeAgentId: "exec-1",
        sendToOrgChartSectionId: "sec-1",
        sendToSectionAgentIds: ["a", "b"],
      }),
    ).toBe(true);
    expect(
      isJobOrderExecutionOutsideSendToDepartment({
        executionAssigneeAgentId: "a",
        sendToOrgChartSectionId: "sec-1",
        sendToSectionAgentIds: ["a", "b"],
      }),
    ).toBe(false);
    expect(
      isJobOrderExecutionOutsideSendToDepartment({
        executionAssigneeAgentId: "exec-1",
        sendToOrgChartSectionId: null,
        sendToSectionAgentIds: ["a"],
      }),
    ).toBe(false);
  });
});
