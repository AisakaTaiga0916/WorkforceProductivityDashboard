import { describe, expect, it } from "vitest";
import {
  defaultPaymentApprovalMeta,
  nextPaymentApprovalStep,
  parsePaymentApprovalMeta,
  paymentProceduralStatusLabel,
  stampPaymentAssigneeAsPreparedBy,
  assigneeFieldForStep,
  isPaymentProcedureGreenLit,
  isPaymentStepApprovedAck,
  markPaymentStepApproved,
  completePaymentApprovalStep,
  paymentStepRequiresApprovedAck,
  PAYMENT_APPROVAL_STEPS,
} from "@/modules/requests/request-for-payment-approval";
import {
  applyRequisitionPricingDerivedFields,
  computeRequisitionPriceQuotation,
  sumRequisitionListedItemsTotal,
} from "@/modules/requests/item-requisition";

describe("RFP procedural approval chain", () => {
  it("starts at NOTED_BY and advances through Accounting and Finance", () => {
    expect(PAYMENT_APPROVAL_STEPS).toEqual([
      "NOTED_BY",
      "APPROVED_BY",
      "APPROVED_BY_ACCOUNTING",
      "APPROVED_BY_FINANCE",
    ]);
    expect(defaultPaymentApprovalMeta().proceduralStep).toBe("NOTED_BY");
    expect(paymentProceduralStatusLabel("NOTED_BY")).toBe("NOTED BY IS MISSING");
    expect(assigneeFieldForStep("NOTED_BY")).toBe("notedByAgentId");
    expect(assigneeFieldForStep("APPROVED_BY")).toBe("approvedByAgentId");
    expect(assigneeFieldForStep("APPROVED_BY_ACCOUNTING")).toBe("accountingAgentId");
    expect(assigneeFieldForStep("APPROVED_BY_FINANCE")).toBe("financeAgentId");

    let step = defaultPaymentApprovalMeta().proceduralStep;
    const expected = ["APPROVED_BY", "APPROVED_BY_ACCOUNTING", "APPROVED_BY_FINANCE", "DONE"] as const;
    for (const next of expected) {
      step = nextPaymentApprovalStep(step);
      expect(step).toBe(next);
    }
    expect(isPaymentProcedureGreenLit({ ...defaultPaymentApprovalMeta(), proceduralStep: "DONE" })).toBe(
      true,
    );
    expect(isPaymentProcedureGreenLit(defaultPaymentApprovalMeta())).toBe(false);
  });

  it("records Prepared By without advancing the procedural chain", () => {
    const stamped = stampPaymentAssigneeAsPreparedBy(defaultPaymentApprovalMeta(), "agent-1");
    expect(stamped.preparedByAgentId).toBe("agent-1");
    expect(stamped.proceduralStep).toBe("NOTED_BY");
    expect(stamped.completed.NOTED_BY).toBeFalsy();
  });

  it("parses legacy meta and remaps old step keys", () => {
    const parsed = parsePaymentApprovalMeta({
      notedByAgentId: "n1",
      approvedByAgentId: null,
      accountingAgentId: "a1",
      financeAgentId: null,
      proceduralStep: "RECEIVED_BY_ACCOUNTING",
      completed: { PREPARED_BY: "2026-01-01T00:00:00.000Z", RECEIVED_BY_ACCOUNTING: "2026-01-02T00:00:00.000Z" },
    });
    expect(parsed?.preparedByAgentId).toBeNull();
    expect(parsed?.proceduralStep).toBe("APPROVED_BY_ACCOUNTING");
    expect(parsed?.completed.APPROVED_BY_ACCOUNTING).toBeTruthy();
  });

  it("maps legacy PREPARED_BY / RECEIVED_BY steps onto the new chain", () => {
    expect(parsePaymentApprovalMeta({ proceduralStep: "PREPARED_BY", completed: {} })?.proceduralStep).toBe(
      "NOTED_BY",
    );
    expect(
      parsePaymentApprovalMeta({ proceduralStep: "RECEIVED_BY_ACCOUNTING", completed: {} })?.proceduralStep,
    ).toBe("APPROVED_BY_ACCOUNTING");
    expect(parsePaymentApprovalMeta({ proceduralStep: "APPROVED_BY", completed: {} })?.proceduralStep).toBe(
      "APPROVED_BY",
    );
  });
  it("requires Approved before Done for Accounting and Finance", () => {
    const accounting = {
      ...defaultPaymentApprovalMeta(),
      proceduralStep: "APPROVED_BY_ACCOUNTING" as const,
      accountingAgentId: "acct-1",
    };
    expect(paymentStepRequiresApprovedAck("APPROVED_BY_ACCOUNTING")).toBe(true);
    expect(paymentStepRequiresApprovedAck("NOTED_BY")).toBe(false);
    expect(isPaymentStepApprovedAck(accounting, "APPROVED_BY_ACCOUNTING")).toBe(false);
    const marked = markPaymentStepApproved(accounting);
    expect(isPaymentStepApprovedAck(marked, "APPROVED_BY_ACCOUNTING")).toBe(true);
    expect(marked.proceduralStep).toBe("APPROVED_BY_ACCOUNTING");
    expect(marked.completed.APPROVED_BY_ACCOUNTING).toBeFalsy();
    const advanced = completePaymentApprovalStep(marked);
    expect(advanced.proceduralStep).toBe("APPROVED_BY_FINANCE");
    expect(advanced.completed.APPROVED_BY_ACCOUNTING).toBeTruthy();
  });

  it("parses stepApproved stamps for Accounting/Finance", () => {
    const parsed = parsePaymentApprovalMeta({
      proceduralStep: "APPROVED_BY_FINANCE",
      stepApproved: { APPROVED_BY_ACCOUNTING: "2026-01-01T00:00:00.000Z" },
      completed: {},
    });
    expect(parsed?.stepApproved.APPROVED_BY_ACCOUNTING).toBeTruthy();
    expect(parsed?.stepApproved.APPROVED_BY_FINANCE).toBeFalsy();
  });
});

describe("IRS price quotation formula", () => {
  it("computes PRICE QUOTATION = QUANTITY × UNIT PRICE", () => {
    expect(
      computeRequisitionPriceQuotation({
        quantity: "3",
        unitPrice: "25.50",
        priceQuotation: "",
        total: "",
      }),
    ).toBe("76.50");
  });

  it("applies derived fields and sums Grand Total from quotations", () => {
    const a = applyRequisitionPricingDerivedFields({
      itemNumber: "1",
      quantity: "2",
      unit: "pcs",
      particular: "Widget",
      unitPrice: "10",
    });
    const b = applyRequisitionPricingDerivedFields({
      itemNumber: "2",
      quantity: "4",
      unit: "pcs",
      particular: "Bolt",
      unitPrice: "2.5",
    });
    expect(a.priceQuotation).toBe("20.00");
    expect(b.priceQuotation).toBe("10.00");
    expect(sumRequisitionListedItemsTotal([a, b])).toBe("30.00");
  });
});
