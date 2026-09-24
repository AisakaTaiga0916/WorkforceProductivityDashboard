import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildTravelOrderRecommendedPath,
  isApprovalHierarchySatisfied,
  isTravelOrderConfirmReady,
  normalizeApprovalLevelsForStore,
} from "../../src/lib/travel-order";
import {
  buildWorkPlanApprovalLevelsForStore,
  deriveWorkPlanOrderRequest,
  emptyWorkPlanDraft,
  emptyWorkPlanMeta,
  applyWorkPlanRequestorDefaults,
  formatWorkPlanAmount,
  isWorkPlanOrder,
  workPlanUsesGatePass,
  normalizeWorkPlanMetaForStore,
  parseWorkPlanAmount,
  sumWorkPlanBudgetLines,
  validateWorkPlanDraft,
  WORK_PLAN_APPROVAL_TOP_ORG_LAYER,
  WORK_PLAN_FORMAT_VERSION,
  WORK_PLAN_WIZARD_STEPS,
  workPlanVenueLabels,
} from "../../src/lib/work-plan";

function completeMeta() {
  return emptyWorkPlanMeta({
    departmentBusinessUnit: "IT",
    requestingParty: "Jane Doe",
    personInChargeAgentId: "pic1",
    personInChargeName: "Jane Doe",
    datePrepared: "2026-09-15",
    budgetRequiredBy: "2026-09-30",
    purposeObjective: "Upgrade network",
    activityProposedWorkPlan: "Switch replacement",
    implementationPeriod: "Oct 2026",
    venueLocation: "HQ",
    expectedOutcome: "Stable network",
    personnel: [
      {
        name: "Jane Doe",
        positionDepartment: "IT / Ops",
        responsibilityRole: "Lead",
      },
    ],
    budgetLines: [{ particulars: "Switches", basisQuantity: "2 units", amount: "50,000.00" }],
    justification: "Aging hardware causes downtime.",
    expectedResults: [{ deliverable: "All switches installed", targetDate: "2026-10-31" }],
    venues: [
      { label: "HQ", startAt: "2026-10-01", endAt: "2026-10-03" },
      { label: "Site B", startAt: "2026-10-04", endAt: "2026-10-05" },
    ],
  });
}

describe("work plan validation", () => {
  it("rejects empty drafts", () => {
    const err = validateWorkPlanDraft(emptyWorkPlanDraft());
    assert.ok(err);
    assert.match(err!, /Department/i);
  });

  it("accepts a complete draft with org-chart approval levels", () => {
    const draft = emptyWorkPlanDraft({
      workPlan: completeMeta(),
      approvalLevels: [
        { level: 1, agentId: "mgr1", optional: false },
        { level: 2, agentId: "mgr2", optional: false },
      ],
      confirmationByAgentId: "confirm1",
    });
    assert.equal(validateWorkPlanDraft(draft), null);
  });

  it("allows empty expected outcome and empty expected results", () => {
    const draft = emptyWorkPlanDraft({
      workPlan: emptyWorkPlanMeta({
        ...completeMeta(),
        expectedOutcome: "",
        expectedResults: [{ deliverable: "", targetDate: "" }],
      }),
      approvalLevels: [
        { level: 1, agentId: "mgr1", optional: false },
        { level: 2, agentId: "mgr2", optional: false },
      ],
      confirmationByAgentId: "confirm1",
    });
    assert.equal(validateWorkPlanDraft(draft), null);
  });

  it("still requires both fields when an expected-result row is started", () => {
    const draft = emptyWorkPlanDraft({
      workPlan: emptyWorkPlanMeta({
        ...completeMeta(),
        expectedResults: [{ deliverable: "Report", targetDate: "" }],
      }),
      approvalLevels: [
        { level: 1, agentId: "mgr1", optional: false },
        { level: 2, agentId: "mgr2", optional: false },
      ],
      confirmationByAgentId: "confirm1",
    });
    assert.match(validateWorkPlanDraft(draft) ?? "", /Target Date/i);
  });

  it("requires a confirmer", () => {
    const draft = emptyWorkPlanDraft({
      workPlan: completeMeta(),
      approvalLevels: [
        { level: 1, agentId: "mgr1", optional: false },
        { level: 2, agentId: "mgr2", optional: false },
      ],
    });
    assert.match(validateWorkPlanDraft(draft) ?? "", /confirm/i);
  });

  it("requires distinct approvers", () => {
    const draft = emptyWorkPlanDraft({
      workPlan: completeMeta(),
      approvalLevels: [
        { level: 1, agentId: "same", optional: false },
        { level: 2, agentId: "same", optional: false },
      ],
    });
    assert.match(validateWorkPlanDraft(draft) ?? "", /different/i);
  });

  it("requires a tagged driver when Driver Present is on", () => {
    const draft = emptyWorkPlanDraft({
      workPlan: emptyWorkPlanMeta({
        ...completeMeta(),
        driverPresent: true,
        personnel: [
          {
            name: "Jane Doe",
            positionDepartment: "IT / Ops",
            responsibilityRole: "Lead",
            isDriver: false,
          },
        ],
      }),
      approvalLevels: [
        { level: 1, agentId: "mgr1", optional: false },
        { level: 2, agentId: "mgr2", optional: false },
      ],
    });
    assert.match(validateWorkPlanDraft(draft) ?? "", /driver/i);

    const tagged = emptyWorkPlanDraft({
      workPlan: emptyWorkPlanMeta({
        ...completeMeta(),
        driverPresent: true,
        personnel: [
          {
            name: "Jane Doe",
            positionDepartment: "IT / Ops",
            responsibilityRole: "Lead",
            isDriver: true,
          },
        ],
      }),
      approvalLevels: [
        { level: 1, agentId: "mgr1", optional: false },
        { level: 2, agentId: "mgr2", optional: false },
      ],
      confirmationByAgentId: "confirm1",
    });
    assert.equal(validateWorkPlanDraft(tagged), null);
  });
});

describe("work plan budget helpers", () => {
  it("parses and sums amounts", () => {
    assert.equal(parseWorkPlanAmount("₱1,250.50"), 1250.5);
    assert.equal(
      sumWorkPlanBudgetLines([
        { particulars: "a", basisQuantity: "1", amount: "100" },
        { particulars: "b", basisQuantity: "2", amount: "50.5" },
      ]),
      150.5,
    );
    assert.equal(formatWorkPlanAmount(150.5), "150.50");
  });

  it("normalizes totals on store", () => {
    const meta = normalizeWorkPlanMetaForStore(
      emptyWorkPlanMeta({
        budgetLines: [
          { particulars: "A", basisQuantity: "1", amount: "1000" },
          { particulars: "", basisQuantity: "", amount: "" },
        ],
      }),
    );
    assert.equal(meta.formatVersion, WORK_PLAN_FORMAT_VERSION);
    assert.equal(meta.budgetLines.length, 1);
    assert.equal(meta.totalEstimatedBudget, "1,000.00");
  });
});

describe("work plan approval seats", () => {
  it("builds layered seats from org-chart path up to Layer 2 (Layer 1 excluded)", () => {
    const seats = buildTravelOrderRecommendedPath({
      requestorOrgLayer: 4,
      topOrgLayer: WORK_PLAN_APPROVAL_TOP_ORG_LAYER,
      ancestors: [
        {
          orgChartLayer: 3,
          agentId: "a3",
          agentName: "Layer 3",
          mergedSourceUserId: "m3",
        },
        {
          orgChartLayer: 2,
          agentId: "a2",
          agentName: "Layer 2",
          mergedSourceUserId: "m2",
        },
        {
          orgChartLayer: 1,
          agentId: "a1",
          agentName: "Top",
          mergedSourceUserId: "m1",
        },
      ],
    });
    assert.equal(seats.length, 2);
    assert.equal(seats[0]!.orgChartLayer, 3);
    assert.equal(seats[1]!.orgChartLayer, 2);

    const levels = normalizeApprovalLevelsForStore(
      buildWorkPlanApprovalLevelsForStore(seats),
    );
    assert.equal(levels.length, 2);
    assert.equal(levels[0]!.agentId, "a3");
    assert.equal(levels[1]!.agentId, "a2");
    assert.ok(levels.every((l) => !l.optional));
    assert.equal(isApprovalHierarchySatisfied(levels), false);

    const afterFirst = levels.map((l) =>
      l.level === 1
        ? { ...l, approvedAt: new Date().toISOString(), approvedByAgentId: "a3" }
        : l,
    );
    assert.equal(isApprovalHierarchySatisfied(afterFirst), false);

    const afterAll = afterFirst.map((l) =>
      l.level === 2
        ? { ...l, approvedAt: new Date().toISOString(), approvedByAgentId: "a2" }
        : l,
    );
    assert.equal(isApprovalHierarchySatisfied(afterAll), true);
  });

  it("detects work plan orders by meta", () => {
    assert.equal(isWorkPlanOrder({ workPlanMeta: null }), false);
    assert.equal(
      isWorkPlanOrder({
        workPlanMeta: emptyWorkPlanMeta(),
      }),
      true,
    );
  });

  it("enables gate pass only when the work plan includes travel", () => {
    assert.equal(
      workPlanUsesGatePass({ workPlanMeta: emptyWorkPlanMeta() }),
      false,
    );
    assert.equal(
      workPlanUsesGatePass({
        workPlanMeta: emptyWorkPlanMeta({ includesTravel: true }),
      }),
      true,
    );
    assert.equal(
      workPlanUsesGatePass({
        workPlanMeta: emptyWorkPlanMeta(),
        gatePassIncluded: true,
      }),
      true,
    );
  });

  it("is confirm-ready after approvals without location visits", () => {
    assert.equal(
      isTravelOrderConfirmReady({
        status: "APPROVED",
        workPlanMeta: emptyWorkPlanMeta(),
        locations: [],
      }),
      true,
    );
    assert.equal(
      isTravelOrderConfirmReady({
        status: "SUBMITTED",
        workPlanMeta: emptyWorkPlanMeta(),
        locations: [],
      }),
      false,
    );
  });

  it("prefills requesting party, department head PIC, and requestor personnel", () => {
    const filled = applyWorkPlanRequestorDefaults(emptyWorkPlanDraft(), {
      requestorName: "Jane Requestor",
      requestorRole: "Staff",
      sectionName: "IT Support",
      majorSectionName: "Information Technology",
      designatedCompanyName: "AGOC",
      departmentHeadAgentId: "head-1",
      departmentHeadName: "Alex Head",
    });
    assert.equal(filled.workPlan.requestingParty, "IT Support");
    assert.equal(filled.workPlan.departmentBusinessUnit, "AGOC");
    assert.equal(filled.workPlan.personInChargeName, "Alex Head");
    assert.equal(filled.workPlan.personInChargeAgentId, "head-1");
    assert.equal(filled.confirmationByAgentId, "head-1");
    assert.equal(filled.workPlan.personnel[0]?.name, "Jane Requestor");
    assert.equal(filled.workPlan.personnel[0]?.positionDepartment, "IT Support");
    assert.equal(filled.workPlan.totalPersonnel, 1);

    const kept = applyWorkPlanRequestorDefaults(filled, {
      requestorName: "Other",
      sectionName: "Finance",
      departmentHeadName: "Other Head",
    });
    assert.equal(kept.workPlan.requestingParty, "IT Support");
    assert.equal(kept.workPlan.personInChargeName, "Alex Head");
    assert.equal(kept.workPlan.personnel[0]?.name, "Jane Requestor");
  });

  it("derives a short order request summary", () => {
    const summary = deriveWorkPlanOrderRequest(
      emptyWorkPlanMeta({
        activityProposedWorkPlan: "Site audit",
        purposeObjective: "Compliance",
      }),
    );
    assert.match(summary, /Site audit/);
    assert.match(summary, /Compliance/);
  });

  it("keeps multiple venues and hydrates from legacy venueLocation", () => {
    const stored = normalizeWorkPlanMetaForStore(
      emptyWorkPlanMeta({
        venues: [
          { label: "HQ", startAt: "2026-10-01", endAt: "2026-10-02" },
          { label: "Plant 2", startAt: "2026-10-03", endAt: "2026-10-04" },
          { label: "" },
        ],
      }),
    );
    assert.deepEqual(workPlanVenueLabels(stored), ["HQ", "Plant 2"]);
    assert.equal(stored.venues[0]?.startAt, "2026-10-01");
    assert.equal(stored.venues[0]?.endAt, "2026-10-02");
    assert.match(stored.venueLocation, /HQ/);
    assert.match(stored.venueLocation, /Plant 2/);

    const legacy = emptyWorkPlanMeta({ venueLocation: "Warehouse A" });
    assert.deepEqual(workPlanVenueLabels(legacy), ["Warehouse A"]);
    assert.equal(legacy.venues[0]?.label, "Warehouse A");
  });
});

describe("work plan wizard", () => {
  it("omits travel and attachments steps", () => {
    const ids = WORK_PLAN_WIZARD_STEPS.map((s) => s.id);
    assert.deepEqual(ids, [
      "general",
      "details",
      "people",
      "budget",
      "justification",
      "results",
      "approval",
    ]);
  });
});
