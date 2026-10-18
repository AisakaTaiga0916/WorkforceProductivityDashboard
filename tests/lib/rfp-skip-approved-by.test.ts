import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  applyPaymentApprovalAssignees,
  completePaymentApprovalStep,
  defaultPaymentApprovalMeta,
  nextPaymentApprovalStep,
  parsePaymentApprovalMeta,
  paymentApprovalStepsFor,
  paymentNotedAndApprovedByComplete,
} from "../../src/modules/requests/request-for-payment-approval";

describe("RFP skip Approved By", () => {
  it("parses skipApprovedBy from stored meta", () => {
    const meta = parsePaymentApprovalMeta({
      notedByAgentId: "n1",
      approvedByAgentId: null,
      accountingAgentId: "a1",
      financeAgentId: "f1",
      proceduralStep: "NOTED_BY",
      completed: {},
      skipApprovedBy: true,
    });
    assert.equal(meta?.skipApprovedBy, true);
    assert.deepEqual(paymentApprovalStepsFor(meta), [
      "NOTED_BY",
      "APPROVED_BY_ACCOUNTING",
      "APPROVED_BY_FINANCE",
    ]);
  });

  it("advances from Noted By straight to Approved By Accounting", () => {
    let meta = defaultPaymentApprovalMeta();
    meta = applyPaymentApprovalAssignees(meta, {
      notedByAgentId: "n1",
      accountingAgentId: "a1",
      financeAgentId: "f1",
    });
    meta = { ...meta, skipApprovedBy: true, approvedByAgentId: null };
    assert.equal(nextPaymentApprovalStep("NOTED_BY", meta), "APPROVED_BY_ACCOUNTING");

    meta = completePaymentApprovalStep(meta);
    assert.equal(meta.proceduralStep, "APPROVED_BY_ACCOUNTING");
    assert.ok(meta.completed.NOTED_BY);
    assert.equal(meta.completed.APPROVED_BY, undefined);
    assert.equal(paymentNotedAndApprovedByComplete(meta), true);
  });

  it("still requires Approved By completion when skip is off", () => {
    let meta = defaultPaymentApprovalMeta();
    meta = applyPaymentApprovalAssignees(meta, {
      notedByAgentId: "n1",
      approvedByAgentId: "ap1",
    });
    meta = completePaymentApprovalStep(meta);
    assert.equal(meta.proceduralStep, "APPROVED_BY");
    assert.equal(paymentNotedAndApprovedByComplete(meta), false);
  });
});
