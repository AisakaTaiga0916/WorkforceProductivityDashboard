import { describe, expect, it } from "vitest";
import { collectRequestChatParticipantAgentIds } from "@/lib/ticket-chat-access";

const base = {
  id: "t1",
  status: "OPEN" as const,
  requestType: "ISSUE_CONCERN_TICKET",
  teamId: null,
  assignedAgentId: "assignee-1",
  orgChartSectionId: null,
  contactName: "Req User",
  contactEmail: "req@example.com",
  requestorEmail: "req@example.com",
  assignedAgent: { id: "assignee-1", email: "a@example.com", name: "Assignee", teamId: null },
  paymentApprovalMeta: null,
  itemRequisitionApprovalMeta: null,
  fundTransferApprovalMeta: null,
  jobOrderApprovalMeta: null,
  acaApprovalMeta: null,
};

describe("collectRequestChatParticipantAgentIds", () => {
  it("ISSUE/CONCERN: assignee only", () => {
    const ids = collectRequestChatParticipantAgentIds(base);
    expect([...ids]).toEqual(["assignee-1"]);
  });

  it("RFP: approvers + bookkeeper + accounting", () => {
    const ids = collectRequestChatParticipantAgentIds({
      ...base,
      requestType: "REQUEST_FOR_PAYMENT",
      assignedAgentId: null,
      paymentApprovalMeta: {
        proceduralStep: "NOTED_BY",
        completed: {},
        stepApproved: {},
        preparedByAgentId: "prep",
        notedByAgentId: "noted",
        approvedByAgentId: "approved",
        accountingAgentId: "bookkeeper",
        financeAgentId: "accounting",
      },
    });
    expect(ids.has("noted")).toBe(true);
    expect(ids.has("approved")).toBe(true);
    expect(ids.has("bookkeeper")).toBe(true);
    expect(ids.has("accounting")).toBe(true);
    expect(ids.has("prep")).toBe(false);
  });

  it("J.O.: approval seats only", () => {
    const ids = collectRequestChatParticipantAgentIds({
      ...base,
      requestType: "JOB_ORDER",
      jobOrderApprovalMeta: {
        proceduralStep: "NOTED_BY",
        completed: {},
        preparedByAgentId: "prep",
        notedByAgentId: "noted",
        approvedByAgentId: "ap1",
        approvedBy2AgentId: "ap2",
        workerAgentIds: ["worker"],
      },
    });
    expect(ids.has("noted")).toBe(true);
    expect(ids.has("ap1")).toBe(true);
    expect(ids.has("ap2")).toBe(true);
    expect(ids.has("prep")).toBe(false);
    expect(ids.has("worker")).toBe(false);
  });

  it("FTR: recommending + approved", () => {
    const ids = collectRequestChatParticipantAgentIds({
      ...base,
      requestType: "FUND_TRANSFER_REQUEST",
      fundTransferApprovalMeta: {
        proceduralStep: "APPROVED_BY",
        completed: {},
        preparedByAgentId: "prep",
        recommendingApprovalAgentId: "rec",
        approvedByAgentId: "ap",
      },
    });
    expect(ids.has("rec")).toBe(true);
    expect(ids.has("ap")).toBe(true);
    expect(ids.has("prep")).toBe(false);
  });

  it("R.S.: canvasser + approved", () => {
    const ids = collectRequestChatParticipantAgentIds({
      ...base,
      requestType: "ITEM_REQUISITION_SLIP",
      itemRequisitionApprovalMeta: {
        proceduralStep: "CANVASSED_BY",
        completed: {},
        canvassedByAgentId: "canvass",
        approvedByAgentId: "ap",
      },
    });
    expect(ids.has("canvass")).toBe(true);
    expect(ids.has("ap")).toBe(true);
  });
});
