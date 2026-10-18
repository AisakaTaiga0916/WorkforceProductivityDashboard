import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  canAssignPaymentApprover,
  canAssignDeferredPaymentAccountingFinance,
  canEditDeferredPaymentMode,
  defaultPaymentApprovalMeta,
  applyPaymentApprovalAssignees,
  completePaymentApprovalStep,
  paymentStepAllowsRepeatSigner,
} from "../../src/modules/requests/request-for-payment-approval";

describe("RFP one-person-one-approval", () => {
  it("rejects assigning a prior role holder when the later step already has a different assignee", () => {
    let meta = defaultPaymentApprovalMeta();
    meta = applyPaymentApprovalAssignees(meta, {
      notedByAgentId: "a1",
      approvedByAgentId: "a2",
    });
    meta = completePaymentApprovalStep(meta);
    const gate = canAssignPaymentApprover({
      meta,
      agentId: "a1",
      forStep: "APPROVED_BY",
    });
    assert.equal(gate.ok, false);
    if (!gate.ok) {
      assert.match(gate.error, /only approve once/i);
    }
  });

  it("allows a prior role holder to take an open later seat (unset Accounting/Finance)", () => {
    let meta = defaultPaymentApprovalMeta();
    meta = applyPaymentApprovalAssignees(meta, {
      notedByAgentId: "a1",
      approvedByAgentId: "a1",
      accountingAgentId: null,
      financeAgentId: null,
    });
    meta = {
      ...meta,
      proceduralStep: "APPROVED_BY_ACCOUNTING",
      completed: { NOTED_BY: "t1", APPROVED_BY: "t2" },
      deferPaymentModeToAccounting: true,
    };
    const gate = canAssignPaymentApprover({
      meta,
      agentId: "a1",
      forStep: "APPROVED_BY_ACCOUNTING",
    });
    assert.equal(gate.ok, true);
  });

  it("allows a new person for the next step", () => {
    let meta = defaultPaymentApprovalMeta();
    meta = applyPaymentApprovalAssignees(meta, { notedByAgentId: "a1" });
    meta = completePaymentApprovalStep(meta);
    const gate = canAssignPaymentApprover({
      meta,
      agentId: "a2",
      forStep: "APPROVED_BY",
    });
    assert.equal(gate.ok, true);
  });

  it("allows re-selecting the same person for the same step", () => {
    let meta = defaultPaymentApprovalMeta();
    meta = applyPaymentApprovalAssignees(meta, { notedByAgentId: "a2" });
    meta = { ...meta, proceduralStep: "NOTED_BY" };
    const gate = canAssignPaymentApprover({
      meta,
      agentId: "a2",
      forStep: "NOTED_BY",
    });
    assert.equal(gate.ok, true);
  });

  it("does not treat Prepared By as a procedural uniqueness conflict", () => {
    let meta = defaultPaymentApprovalMeta();
    meta = applyPaymentApprovalAssignees(meta, {
      preparedByAgentId: "a1",
      notedByAgentId: null,
    });
    const gate = canAssignPaymentApprover({
      meta,
      agentId: "a1",
      forStep: "NOTED_BY",
    });
    assert.equal(gate.ok, true);
  });

  it("starts at APPROVED_BY when Noted By is skipped", () => {
    const meta = defaultPaymentApprovalMeta({ skipNotedBy: true });
    assert.equal(meta.proceduralStep, "APPROVED_BY");
    assert.equal(meta.skipNotedBy, true);
  });

  it("starts at APPROVED_BY_ACCOUNTING when both Noted By and Approved By are skipped", () => {
    const meta = defaultPaymentApprovalMeta({ skipNotedBy: true, skipApprovedBy: true });
    assert.equal(meta.proceduralStep, "APPROVED_BY_ACCOUNTING");
    assert.equal(meta.skipNotedBy, true);
    assert.equal(meta.skipApprovedBy, true);
  });

  it("jumps over APPROVED_BY when Approved By is skipped", () => {
    const meta = defaultPaymentApprovalMeta({ skipApprovedBy: true });
    assert.equal(meta.proceduralStep, "NOTED_BY");
    const advanced = completePaymentApprovalStep(meta);
    assert.equal(advanced.proceduralStep, "APPROVED_BY_ACCOUNTING");
    assert.ok(advanced.completed.NOTED_BY);
    assert.equal(advanced.completed.APPROVED_BY, undefined);
  });

  it("keeps APPROVED_BY in the chain when only Noted By is skipped", () => {
    let meta = defaultPaymentApprovalMeta({ skipNotedBy: true });
    assert.equal(meta.proceduralStep, "APPROVED_BY");
    meta = completePaymentApprovalStep(meta);
    assert.equal(meta.proceduralStep, "APPROVED_BY_ACCOUNTING");
    assert.equal(meta.completed.NOTED_BY, undefined);
    assert.ok(meta.completed.APPROVED_BY);
  });
});

describe("RFP deferred mode of payment when Accounting/Finance unset", () => {
  it("lets board holder edit deferred mode after Noted By and Approved By are green-lit", () => {
    let meta = defaultPaymentApprovalMeta();
    meta = applyPaymentApprovalAssignees(meta, {
      notedByAgentId: "n1",
      approvedByAgentId: "a1",
      accountingAgentId: null,
      financeAgentId: null,
    });
    meta = {
      ...meta,
      proceduralStep: "APPROVED_BY_ACCOUNTING",
      completed: { NOTED_BY: "t1", APPROVED_BY: "t2" },
      deferPaymentModeToAccounting: true,
    };
    assert.equal(
      canEditDeferredPaymentMode({
        meta,
        proceduralStep: "APPROVED_BY_ACCOUNTING",
        modeOfPayment: "",
      }),
      true,
    );
  });

  it("does not unlock mode edit before Approved By is complete", () => {
    let meta = defaultPaymentApprovalMeta();
    meta = applyPaymentApprovalAssignees(meta, {
      approvedByAgentId: "a1",
      accountingAgentId: null,
      financeAgentId: null,
    });
    meta = {
      ...meta,
      proceduralStep: "APPROVED_BY",
      completed: { NOTED_BY: "t1" },
      deferPaymentModeToAccounting: true,
    };
    assert.equal(
      canEditDeferredPaymentMode({
        meta,
        proceduralStep: "APPROVED_BY",
        modeOfPayment: "",
      }),
      false,
    );
  });

  it("allows assigning Accounting/Finance after Noted By and Approved By are green-lit", () => {
    let meta = defaultPaymentApprovalMeta();
    meta = {
      ...meta,
      proceduralStep: "APPROVED_BY_ACCOUNTING",
      accountingAgentId: null,
      financeAgentId: null,
      completed: { NOTED_BY: "t1", APPROVED_BY: "t2" },
      deferPaymentModeToAccounting: true,
    };
    assert.equal(
      canAssignDeferredPaymentAccountingFinance({
        meta,
        modeOfPayment: "",
      }),
      true,
    );
    // Seats can also be filled when mode of payment was already set at intake.
    meta = { ...meta, deferPaymentModeToAccounting: false };
    assert.equal(
      canAssignDeferredPaymentAccountingFinance({
        meta,
        modeOfPayment: "Check",
      }),
      true,
    );
  });

  it("releases the prior-signee lock when the current Accounting seat is unset", () => {
    let meta = defaultPaymentApprovalMeta();
    meta = applyPaymentApprovalAssignees(meta, {
      approvedByAgentId: "a1",
      accountingAgentId: null,
      financeAgentId: null,
    });
    assert.equal(paymentStepAllowsRepeatSigner(meta, "APPROVED_BY_ACCOUNTING"), true);
    meta = applyPaymentApprovalAssignees(meta, { accountingAgentId: "a2" });
    assert.equal(paymentStepAllowsRepeatSigner(meta, "APPROVED_BY_ACCOUNTING"), false);
  });
});
