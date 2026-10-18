import { describe, expect, it } from "vitest";
import { findCurrentApprovalStep, type ApprovalStep } from "@/components/ui/approval-stepper";
import { paymentApprovalUiSteps } from "@/modules/requests/payment-approval-ui";
import { itemRequisitionApprovalUiSteps } from "@/modules/requests/item-requisition-ui";
import { fundTransferApprovalUiSteps } from "@/modules/requests/fund-transfer-ui";
import { jobOrderApprovalUiSteps } from "@/modules/requests/job-order-ui";
import { jobOrderExecutionUiSteps } from "@/modules/requests/job-order-execution-ui";
import { transferApprovalUiSteps } from "@/modules/requests/ticket-transfer-ui";
import { taskCompletionVerificationUiSteps } from "@/modules/tasks/task-completion-verification-ui";
import { travelOrderApprovalUiSteps } from "@/modules/work-plans/travel-order-ui";
import type { PaymentApprovalMeta } from "@/modules/requests/request-for-payment-approval";
import type { ItemRequisitionApprovalMeta } from "@/modules/requests/item-requisition-approval";
import type { FundTransferApprovalMeta } from "@/modules/requests/fund-transfer-approval";
import type { JobOrderApprovalMeta } from "@/modules/requests/job-order-approval";

function meta(overrides: Partial<PaymentApprovalMeta> = {}): PaymentApprovalMeta {
  return {
    preparedByAgentId: null,
    notedByAgentId: null,
    approvedByAgentId: null,
    accountingAgentId: null,
    financeAgentId: null,
    proceduralStep: "NOTED_BY",
    completed: {},
    stepApproved: {},
    ...overrides,
  };
}

const names = new Map<string, string>([
  ["a1", "Ana Reyes"],
  ["a2", "Ben Cruz"],
  ["a3", "Cara Diaz"],
  ["a4", "Dan Estrada"],
]);

const lookup = (agentId: string | null) => (agentId ? names.get(agentId) ?? null : null);

describe("paymentApprovalUiSteps", () => {
  it("marks earlier steps done, current step active, rest upcoming", () => {
    const steps = paymentApprovalUiSteps({
      meta: meta({
        proceduralStep: "APPROVED_BY_ACCOUNTING",
        notedByAgentId: "a1",
        approvedByAgentId: "a2",
        accountingAgentId: "a3",
        financeAgentId: "a4",
        completed: { NOTED_BY: "2026-10-01T01:00:00.000Z", APPROVED_BY: "2026-10-02T01:00:00.000Z" },
      }),
      agentNameById: lookup,
    });

    expect(steps.map((s) => s.id)).toEqual([
      "NOTED_BY",
      "APPROVED_BY",
      "APPROVED_BY_ACCOUNTING",
      "APPROVED_BY_FINANCE",
    ]);
    expect(steps.map((s) => s.state)).toEqual(["done", "done", "current", "upcoming"]);
    expect(steps[0]).toMatchObject({ label: "NOTED BY", actorName: "Ana Reyes" });
    expect(steps[2]).toMatchObject({ label: "PREPARED BY BOOKKEEPER", actorName: "Cara Diaz" });
    expect(steps[3]).toMatchObject({ actorName: "Dan Estrada", decidedAt: null });
  });

  it("honors skipNotedBy / skipApprovedBy", () => {
    const steps = paymentApprovalUiSteps({
      meta: meta({ skipNotedBy: true, skipApprovedBy: true, proceduralStep: "APPROVED_BY_ACCOUNTING" }),
      agentNameById: lookup,
    });
    expect(steps.map((s) => s.id)).toEqual(["APPROVED_BY_ACCOUNTING", "APPROVED_BY_FINANCE"]);
    expect(steps[0].state).toBe("current");
  });

  it("DONE meta marks every step done", () => {
    const steps = paymentApprovalUiSteps({
      meta: meta({
        proceduralStep: "DONE",
        completed: {
          NOTED_BY: "2026-10-01T01:00:00.000Z",
          APPROVED_BY: "2026-10-02T01:00:00.000Z",
          APPROVED_BY_ACCOUNTING: "2026-10-03T01:00:00.000Z",
          APPROVED_BY_FINANCE: "2026-10-04T01:00:00.000Z",
        },
      }),
      agentNameById: lookup,
    });
    expect(steps.every((s) => s.state === "done")).toBe(true);
    expect(findCurrentApprovalStep(steps)).toBeUndefined();
  });

  it("missing assignee renders a null actor", () => {
    const steps = paymentApprovalUiSteps({
      meta: meta({ proceduralStep: "NOTED_BY" }),
      agentNameById: lookup,
    });
    expect(steps[0]).toMatchObject({ state: "current", actorName: null, decidedAt: null });
  });
});

describe("findCurrentApprovalStep", () => {
  it("returns the current step only", () => {
    const steps: ApprovalStep[] = [
      { id: "a", label: "A", state: "done" },
      { id: "b", label: "B", state: "current" },
      { id: "c", label: "C", state: "upcoming" },
    ];
    expect(findCurrentApprovalStep(steps)?.id).toBe("b");
    expect(findCurrentApprovalStep([])).toBeUndefined();
  });
});

describe("itemRequisitionApprovalUiSteps", () => {
  function requisitionMeta(
    overrides: Partial<ItemRequisitionApprovalMeta> = {},
  ): ItemRequisitionApprovalMeta {
    return {
      canvassedByAgentId: null,
      approvedByAgentId: null,
      proceduralStep: "CANVASSED_BY",
      completed: {},
      ...overrides,
    };
  }

  it("marks the canvass step current first", () => {
    const steps = itemRequisitionApprovalUiSteps({
      meta: requisitionMeta({ canvassedByAgentId: "a1", approvedByAgentId: "a2" }),
      agentNameById: lookup,
    });
    expect(steps.map((s) => s.id)).toEqual(["CANVASSED_BY", "APPROVED_BY"]);
    expect(steps.map((s) => s.state)).toEqual(["current", "upcoming"]);
    expect(steps[0]).toMatchObject({ label: "CANVASSED BY", actorName: "Ana Reyes" });
    expect(steps[1]).toMatchObject({ label: "APPROVED BY", actorName: "Ben Cruz" });
  });

  it("moves to Approved By once canvassing is stamped", () => {
    const steps = itemRequisitionApprovalUiSteps({
      meta: requisitionMeta({
        proceduralStep: "APPROVED_BY",
        canvassedByAgentId: "a1",
        approvedByAgentId: "a2",
        completed: { CANVASSED_BY: "2026-10-05T01:00:00.000Z" },
      }),
      agentNameById: lookup,
    });
    expect(steps.map((s) => s.state)).toEqual(["done", "current"]);
    expect(steps[0]).toMatchObject({
      actorName: "Ana Reyes",
      decidedAt: "2026-10-05T01:00:00.000Z",
    });
  });

  it("DONE meta marks every step done", () => {
    const steps = itemRequisitionApprovalUiSteps({
      meta: requisitionMeta({
        proceduralStep: "DONE",
        completed: {
          CANVASSED_BY: "2026-10-05T01:00:00.000Z",
          APPROVED_BY: "2026-10-06T01:00:00.000Z",
        },
      }),
      agentNameById: lookup,
    });
    expect(steps.every((s) => s.state === "done")).toBe(true);
    expect(findCurrentApprovalStep(steps)).toBeUndefined();
  });

  it("missing assignee renders a null actor", () => {
    const steps = itemRequisitionApprovalUiSteps({
      meta: requisitionMeta(),
      agentNameById: lookup,
    });
    expect(steps[0]).toMatchObject({ state: "current", actorName: null, decidedAt: null });
  });
});

describe("fundTransferApprovalUiSteps", () => {
  function transferMeta(
    overrides: Partial<FundTransferApprovalMeta> = {},
  ): FundTransferApprovalMeta {
    return {
      preparedByAgentId: null,
      recommendingApprovalAgentId: null,
      approvedByAgentId: null,
      proceduralStep: "PREPARED_BY",
      completed: {},
      ...overrides,
    };
  }

  it("hides intake-only Prepared By and marks the current seat", () => {
    const steps = fundTransferApprovalUiSteps({
      meta: transferMeta({
        proceduralStep: "RECOMMENDING_APPROVAL",
        preparedByAgentId: "a1",
        recommendingApprovalAgentId: "a2",
        approvedByAgentId: "a3",
      }),
      agentNameById: lookup,
    });
    expect(steps.map((s) => s.id)).toEqual(["RECOMMENDING_APPROVAL", "APPROVED_BY"]);
    expect(steps.map((s) => s.state)).toEqual(["current", "upcoming"]);
    expect(steps[0]).toMatchObject({ label: "RECOMMENDING APPROVAL", actorName: "Ben Cruz" });
  });

  it("completes the chain when DONE", () => {
    const steps = fundTransferApprovalUiSteps({
      meta: transferMeta({
        proceduralStep: "DONE",
        completed: {
          RECOMMENDING_APPROVAL: "2026-10-05T01:00:00.000Z",
          APPROVED_BY: "2026-10-06T01:00:00.000Z",
        },
      }),
      agentNameById: lookup,
    });
    expect(steps.every((s) => s.state === "done")).toBe(true);
    expect(findCurrentApprovalStep(steps)).toBeUndefined();
  });
});

describe("jobOrderApprovalUiSteps", () => {
  function jobOrderMeta(overrides: Partial<JobOrderApprovalMeta> = {}): JobOrderApprovalMeta {
    return {
      preparedByAgentId: null,
      notedByAgentId: null,
      approvedByAgentId: null,
      approvedBy2AgentId: null,
      proceduralStep: "NOTED_BY",
      completed: {},
      workerAgentIds: [],
      executionAssignedAt: null,
      ...overrides,
    };
  }

  it("starts with Noted By current", () => {
    const steps = jobOrderApprovalUiSteps({
      meta: jobOrderMeta({
        notedByAgentId: "a1",
        approvedByAgentId: "a2",
        approvedBy2AgentId: "a3",
      }),
      agentNameById: lookup,
    });
    expect(steps.map((s) => s.id)).toEqual(["NOTED_BY", "APPROVED_BY", "APPROVED_BY_2"]);
    expect(steps.map((s) => s.state)).toEqual(["current", "upcoming", "upcoming"]);
    expect(steps[0]).toMatchObject({ label: "NOTED BY", actorName: "Ana Reyes" });
  });

  it("honors skipNotedBy / skipApprovedBy", () => {
    const steps = jobOrderApprovalUiSteps({
      meta: jobOrderMeta({
        skipNotedBy: true,
        skipApprovedBy: true,
        proceduralStep: "APPROVED_BY_2",
        approvedBy2AgentId: "a3",
      }),
      agentNameById: lookup,
    });
    expect(steps.map((s) => s.id)).toEqual(["APPROVED_BY_2"]);
    expect(steps[0]).toMatchObject({ state: "current", actorName: "Cara Diaz" });
  });

  it("DONE meta marks every visible step done", () => {
    const steps = jobOrderApprovalUiSteps({
      meta: jobOrderMeta({
        proceduralStep: "DONE",
        completed: {
          NOTED_BY: "2026-10-05T01:00:00.000Z",
          APPROVED_BY: "2026-10-06T01:00:00.000Z",
          APPROVED_BY_2: "2026-10-07T01:00:00.000Z",
        },
      }),
      agentNameById: lookup,
    });
    expect(steps.every((s) => s.state === "done")).toBe(true);
    expect(findCurrentApprovalStep(steps)).toBeUndefined();
  });
});

describe("transferApprovalUiSteps", () => {
  it("marks the request done and reassignment current", () => {
    const steps = transferApprovalUiSteps({
      fromAgentName: "Ana Reyes",
      recipientAgentName: "Ben Cruz",
    });
    expect(steps.map((s) => s.id)).toEqual(["REQUESTED", "REASSIGNED"]);
    expect(steps.map((s) => s.state)).toEqual(["done", "current"]);
    expect(steps[0]).toMatchObject({ actorName: "Ana Reyes" });
    expect(steps[1]).toMatchObject({ actorName: "Ben Cruz" });
  });

  it("tolerates missing names", () => {
    const steps = transferApprovalUiSteps({});
    expect(steps.map((s) => s.state)).toEqual(["done", "current"]);
    expect(steps[0]?.actorName).toBeNull();
    expect(steps[0]?.decidedAt).toBeNull();
  });
});

describe("jobOrderExecutionUiSteps", () => {
  function executionMeta(overrides: Partial<JobOrderApprovalMeta> = {}): JobOrderApprovalMeta {
    return {
      preparedByAgentId: null,
      notedByAgentId: null,
      approvedByAgentId: null,
      approvedBy2AgentId: null,
      proceduralStep: "DONE",
      completed: {},
      workerAgentIds: [],
      executionAssignedAt: null,
      ...overrides,
    };
  }

  it("shows execution current until Job Done", () => {
    const steps = jobOrderExecutionUiSteps({
      meta: executionMeta(),
      executionAssigneeName: "Dana Fox",
    });
    expect(steps.map((s) => s.id)).toEqual(["EXECUTION", "CONFIRMATION"]);
    expect(steps.map((s) => s.state)).toEqual(["current", "upcoming"]);
    expect(steps[0]).toMatchObject({ actorName: "Dana Fox", decidedAt: null });
  });

  it("marks execution done with the Job Done stamp and confirmation current", () => {
    const steps = jobOrderExecutionUiSteps({
      meta: executionMeta({ jobDoneAt: "2026-10-10T02:00:00.000Z" }),
      ticketStatus: "FOR_CONFIRMATION",
    });
    expect(steps.map((s) => s.state)).toEqual(["done", "current"]);
    expect(steps[0]?.decidedAt).toBe("2026-10-10T02:00:00.000Z");
  });
});

describe("taskCompletionVerificationUiSteps", () => {
  it("marks submission done and verification current while pending", () => {
    const steps = taskCompletionVerificationUiSteps({
      submittedAt: "2026-10-12T01:00:00.000Z",
    });
    expect(steps.map((s) => s.id)).toEqual(["SUBMITTED", "VERIFIED"]);
    expect(steps.map((s) => s.state)).toEqual(["done", "current"]);
    expect(steps[0]?.decidedAt).toBe("2026-10-12T01:00:00.000Z");
    expect(steps[1]).toMatchObject({ actorName: null, decidedAt: null });
  });

  it("marks verification done with verifier and timestamp", () => {
    const steps = taskCompletionVerificationUiSteps({
      submittedAt: "2026-10-12T01:00:00.000Z",
      verifierName: "Head One",
      verifiedAt: "2026-10-13T02:00:00.000Z",
    });
    expect(steps.map((s) => s.state)).toEqual(["done", "done"]);
    expect(steps[1]).toMatchObject({ actorName: "Head One" });
    expect(findCurrentApprovalStep(steps)).toBeUndefined();
  });

  it("shows the returned state until the work is re-submitted", () => {
    const steps = taskCompletionVerificationUiSteps({
      submittedAt: "2026-10-12T01:00:00.000Z",
      returned: true,
    });
    expect(steps.map((s) => s.state)).toEqual(["done", "returned"]);
    expect(findCurrentApprovalStep(steps)).toBeUndefined();
  });

  it("ignores returned when a verification timestamp exists", () => {
    const steps = taskCompletionVerificationUiSteps({
      returned: true,
      verifiedAt: "2026-10-13T02:00:00.000Z",
    });
    expect(steps.map((s) => s.state)).toEqual(["done", "done"]);
  });
});

describe("travelOrderApprovalUiSteps", () => {
  const levels = [
    { level: 1, agentId: "a1", agent: { name: "Head One" }, approvedAt: "2026-10-01T01:00:00.000Z" },
    { level: 2, agentId: "a2", agent: { name: "Head Two" }, approvedAt: null },
    { level: 3, agentId: "a3", agent: { name: "Head Three" }, approvedAt: null },
  ];

  it("marks the operator's actionable level current", () => {
    const steps = travelOrderApprovalUiSteps({ levels, actionableLevel: 2 });
    expect(steps.map((s) => s.id)).toEqual(["LEVEL_1", "LEVEL_2", "LEVEL_3"]);
    expect(steps.map((s) => s.state)).toEqual(["done", "current", "upcoming"]);
    expect(steps[1]).toMatchObject({ label: "LEVEL 2 APPROVAL", actorName: "Head Two" });
    expect(steps[0]?.decidedAt).toBe("2026-10-01T01:00:00.000Z");
  });

  it("falls back to the first incomplete level without an actionable match", () => {
    const steps = travelOrderApprovalUiSteps({ levels });
    expect(steps.map((s) => s.state)).toEqual(["done", "current", "upcoming"]);
    expect(findCurrentApprovalStep(steps)?.id).toBe("LEVEL_2");
  });

  it("tolerates unassigned and unnamed seats", () => {
    const steps = travelOrderApprovalUiSteps({
      levels: [{ level: 1, agentId: null, agent: null, approvedAt: null }],
    });
    expect(steps[0]).toMatchObject({ state: "current", actorName: null });
  });
});
