import { describe, expect, it } from "vitest";
import {
  applyJobOrderAssistanceTeam,
  applyJobOrderWorkerAgentIds,
  completeJobOrderApprovalStep,
  currentJobOrderStepBoardAssigneeId,
  defaultJobOrderApprovalMeta,
  parseJobOrderWorkerAgentIds,
  isJobOrderAwaitingExecutionAssignee,
  isJobOrderExecutionWorkspaceOpen,
  isJobOrderProcedureGreenLit,
  hasJobOrderFirstApprovalCompleted,
  markJobOrderExecutionAssigned,
  promoteJobOrderPendingExecutionAssignee,
  setJobOrderPendingExecutionAssignee,
  canMarkJobOrderDone,
} from "@/lib/job-order-approval";
import {
  isJobOrderExecutionMember,
  jobOrderKpiCreditAgentIds,
} from "@/lib/job-order-workers";

describe("job order workers", () => {
  it("stores co-workers separately from the execution assignee", () => {
    const meta = applyJobOrderWorkerAgentIds(
      defaultJobOrderApprovalMeta(),
      ["worker-1", "assignee-1", "worker-1"],
      "assignee-1",
    );
    expect(parseJobOrderWorkerAgentIds(meta)).toEqual(["worker-1"]);
  });

  it("credits assignee and listed co-workers", () => {
    const meta = applyJobOrderWorkerAgentIds(defaultJobOrderApprovalMeta(), ["worker-1"], "assignee-1");
    expect(
      jobOrderKpiCreditAgentIds({
        meta,
        ticketAssignedAgentId: "assignee-1",
        linkedProjectAssigneeId: null,
      }).sort(),
    ).toEqual(["assignee-1", "worker-1"]);
  });

  it("treats ticket assignee as execution member", () => {
    expect(
      isJobOrderExecutionMember({
        agentId: "assignee-1",
        meta: defaultJobOrderApprovalMeta(),
        ticketAssignedAgentId: "assignee-1",
        linkedProjectAssigneeId: null,
      }),
    ).toBe(true);
  });

  it("treats linked project assignee as execution member", () => {
    expect(
      isJobOrderExecutionMember({
        agentId: "project-assignee",
        meta: defaultJobOrderApprovalMeta(),
        ticketAssignedAgentId: null,
        linkedProjectAssigneeId: "project-assignee",
      }),
    ).toBe(true);
  });

  it("returns no board assignee when approval is DONE (icon should clear)", () => {
    let meta = defaultJobOrderApprovalMeta();
    meta = { ...meta, proceduralStep: "APPROVED_BY_2", approvedBy2AgentId: "approver-2" };
    const done = completeJobOrderApprovalStep(meta);
    expect(done.proceduralStep).toBe("DONE");
    expect(currentJobOrderStepBoardAssigneeId(done)).toBeNull();
  });

  it("awaits execution assignee until explicitly marked", () => {
    let meta = defaultJobOrderApprovalMeta();
    meta = { ...meta, proceduralStep: "DONE" };
    expect(isJobOrderAwaitingExecutionAssignee(meta)).toBe(true);
    meta = markJobOrderExecutionAssigned(meta);
    expect(isJobOrderAwaitingExecutionAssignee(meta)).toBe(false);
  });

  it("opens execution workspace after Noted By and Approved By complete", () => {
    let meta = defaultJobOrderApprovalMeta();
    expect(hasJobOrderFirstApprovalCompleted(meta)).toBe(false);
    expect(isJobOrderExecutionWorkspaceOpen(meta)).toBe(false);
    meta = {
      ...meta,
      proceduralStep: "APPROVED_BY",
      completed: { NOTED_BY: new Date().toISOString() },
    };
    expect(hasJobOrderFirstApprovalCompleted(meta)).toBe(true);
    expect(isJobOrderExecutionWorkspaceOpen(meta)).toBe(false);
    meta = {
      ...meta,
      proceduralStep: "APPROVED_BY_2",
      completed: {
        NOTED_BY: new Date().toISOString(),
        APPROVED_BY: new Date().toISOString(),
      },
    };
    expect(isJobOrderExecutionWorkspaceOpen(meta)).toBe(true);
    expect(isJobOrderProcedureGreenLit(meta)).toBe(false);
  });

  it("opens execution workspace immediately when only the last seat remains", () => {
    const meta = defaultJobOrderApprovalMeta({ skipNotedBy: true, skipApprovedBy: true });
    expect(meta.proceduralStep).toBe("APPROVED_BY_2");
    expect(isJobOrderExecutionWorkspaceOpen(meta)).toBe(true);
  });

  it("promotes pending execution assignee when approvals finish", () => {
    let meta = defaultJobOrderApprovalMeta();
    meta = setJobOrderPendingExecutionAssignee(meta, "exec-1");
    expect(meta.pendingExecutionAssigneeAgentId).toBe("exec-1");
    meta = { ...meta, proceduralStep: "DONE" };
    const promoted = promoteJobOrderPendingExecutionAssignee(meta);
    expect(promoted.agentId).toBe("exec-1");
    expect(promoted.meta.pendingExecutionAssigneeAgentId).toBeNull();
    expect(promoted.meta.executionAssignedAt).toBeTruthy();
  });

  it("allows execution assignee or admin to mark job done", () => {
    let meta = defaultJobOrderApprovalMeta();
    meta = {
      ...meta,
      proceduralStep: "APPROVED_BY_2",
      completed: {
        NOTED_BY: new Date().toISOString(),
        APPROVED_BY: new Date().toISOString(),
      },
    };
    expect(
      canMarkJobOrderDone({
        meta,
        ticketStatus: "IN_PROGRESS",
        ticketAssignedAgentId: null,
        pendingExecutionAssigneeAgentId: "assignee-1",
        actorAgentId: "assignee-1",
        isAdmin: false,
      }).ok,
    ).toBe(true);
    expect(
      canMarkJobOrderDone({
        meta,
        ticketStatus: "IN_PROGRESS",
        ticketAssignedAgentId: null,
        actorAgentId: "other",
        isAdmin: true,
      }).ok,
    ).toBe(true);
    expect(
      canMarkJobOrderDone({
        meta,
        ticketStatus: "IN_PROGRESS",
        ticketAssignedAgentId: null,
        actorAgentId: "other",
        isAdmin: false,
      }).ok,
    ).toBe(false);
    meta = applyJobOrderWorkerAgentIds(meta, ["worker-1"], "assignee-1");
    expect(
      canMarkJobOrderDone({
        meta,
        ticketStatus: "IN_PROGRESS",
        ticketAssignedAgentId: null,
        pendingExecutionAssigneeAgentId: "assignee-1",
        actorAgentId: "worker-1",
        isAdmin: false,
      }).ok,
    ).toBe(true);
    expect(
      canMarkJobOrderDone({
        meta,
        ticketStatus: "FOR_CONFIRMATION",
        ticketAssignedAgentId: "assignee-1",
        actorAgentId: "assignee-1",
        isAdmin: false,
      }).ok,
    ).toBe(false);
  });

  it("allows assistance assignee or co-workers to mark job done", () => {
    let meta = defaultJobOrderApprovalMeta();
    meta = {
      ...meta,
      proceduralStep: "APPROVED_BY_2",
      completed: {
        NOTED_BY: new Date().toISOString(),
        APPROVED_BY: new Date().toISOString(),
      },
    };
    meta = applyJobOrderAssistanceTeam(meta, {
      scopeMode: "department",
      orgChartSectionId: "sec-1",
      companyTeamId: null,
      assigneeAgentId: "assist-1",
      workerAgentIds: ["assist-worker-1"],
    });
    expect(
      canMarkJobOrderDone({
        meta,
        ticketStatus: "IN_PROGRESS",
        ticketAssignedAgentId: "exec-1",
        actorAgentId: "assist-1",
        isAdmin: false,
      }).ok,
    ).toBe(true);
    expect(
      canMarkJobOrderDone({
        meta,
        ticketStatus: "IN_PROGRESS",
        ticketAssignedAgentId: "exec-1",
        actorAgentId: "assist-worker-1",
        isAdmin: false,
      }).ok,
    ).toBe(true);
    expect(
      canMarkJobOrderDone({
        meta,
        ticketStatus: "IN_PROGRESS",
        ticketAssignedAgentId: "exec-1",
        actorAgentId: "outsider",
        isAdmin: false,
      }).ok,
    ).toBe(false);
  });

  it("blocks Job Done a second time after jobDoneAt is set", () => {
    const meta = {
      ...defaultJobOrderApprovalMeta(),
      proceduralStep: "APPROVED_BY_2" as const,
      completed: {
        NOTED_BY: new Date().toISOString(),
        APPROVED_BY: new Date().toISOString(),
      },
      jobDoneAt: new Date().toISOString(),
    };
    expect(
      canMarkJobOrderDone({
        meta,
        ticketStatus: "IN_PROGRESS",
        ticketAssignedAgentId: "assignee-1",
        actorAgentId: "assignee-1",
        isAdmin: false,
      }).ok,
    ).toBe(false);
  });

  it("treats any matching session agent id as execution team member", () => {
    const meta = applyJobOrderWorkerAgentIds(defaultJobOrderApprovalMeta(), ["worker-legacy"], "assignee-1");
    expect(
      isJobOrderExecutionMember({
        agentIds: ["worker-hris", "worker-legacy"],
        meta,
        ticketAssignedAgentId: "assignee-1",
      }),
    ).toBe(true);
    expect(
      isJobOrderExecutionMember({
        agentIds: ["unrelated"],
        meta,
        ticketAssignedAgentId: "assignee-1",
      }),
    ).toBe(false);
  });
});
