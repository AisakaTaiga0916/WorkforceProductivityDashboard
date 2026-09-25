import { describe, expect, it } from "vitest";
import {
  approvalLevelsAllowOptional,
  canApproveTravelOrderNow,
  canConfirmTravelOrderNow,
  getCurrentApprovalLevel,
  getOperatorActionableApprovalLevel,
  getUnlockedIncompleteLevels,
  isApprovalHierarchySatisfied,
  isApprovalLevelUnlocked,
  normalizeApprovalLevelsForStore,
  parseApprovalLevels,
  sortTravelOrderLevelsByDisplayLayer,
  travelOrderApprovalDisplayLayer,
  travelOrderApprovalSeatCountFromRequestorLayer,
  travelOrderApprovedByLabel,
  travelOrderOrgChartLayersInApprovalPath,
  travelOrderRecommendedOptionalForSeat,
  buildTravelOrderRecommendedPath,
  buildTravelOrderRecommendedPathFromChain,
  mergeTravelOrderApprovalAncestors,
  buildApprovalLevelsFromOrgChartPath,
  travelOrderDraftToFieldAssignmentPayload,
  emptyTravelOrderDraft,
  emptyTravelLocation,
  type TravelOrderApprovalLevelStored,
} from "@/lib/travel-order";

function lvl(
  partial: Partial<TravelOrderApprovalLevelStored> & { level: number; agentId: string },
): TravelOrderApprovalLevelStored {
  return {
    approvedAt: null,
    approvedByAgentId: null,
    optional: false,
    ...partial,
  };
}

describe("optional approval levels", () => {
  it("allows optional config only for 3+ levels", () => {
    expect(approvalLevelsAllowOptional(2)).toBe(false);
    expect(approvalLevelsAllowOptional(3)).toBe(true);
    expect(
      normalizeApprovalLevelsForStore([
        { level: 1, agentId: "a", optional: true },
        { level: 2, agentId: "b", optional: true },
      ]).every((l) => !l.optional),
    ).toBe(true);
    expect(
      normalizeApprovalLevelsForStore([
        { level: 1, agentId: "a", optional: false },
        { level: 2, agentId: "b", optional: true },
        { level: 3, agentId: "c", optional: false },
      ])[1]?.optional,
    ).toBe(true);
  });

  it("parses optional from stored JSON", () => {
    const parsed = parseApprovalLevels([
      { level: 1, agentId: "a", optional: true },
      { level: 2, agentId: "b" },
    ]);
    expect(parsed[0]?.optional).toBe(true);
    expect(parsed[1]?.optional).toBe(false);
  });

  it("lets optional seats act anytime while required seats stay sequential", () => {
    const levels = [
      lvl({ level: 1, agentId: "a1" }),
      lvl({ level: 2, agentId: "a2", optional: true }),
      lvl({ level: 3, agentId: "a3" }),
    ];
    expect(isApprovalLevelUnlocked(levels, 1)).toBe(true);
    expect(isApprovalLevelUnlocked(levels, 2)).toBe(true);
    expect(isApprovalLevelUnlocked(levels, 3)).toBe(false);
    expect(getUnlockedIncompleteLevels(levels).map((l) => l.level)).toEqual([1, 2]);
    expect(canApproveTravelOrderNow("a2", { status: "SUBMITTED", approvalLevels: levels })).toBe(
      true,
    );
    expect(canApproveTravelOrderNow("a3", { status: "SUBMITTED", approvalLevels: levels })).toBe(
      false,
    );
    expect(getOperatorActionableApprovalLevel(levels, "a2")?.level).toBe(2);
    expect(getOperatorActionableApprovalLevel(levels, "a1")?.level).toBe(1);
  });

  it("does not block later required levels behind an optional one", () => {
    const levels = [
      lvl({ level: 1, agentId: "a1", approvedAt: "2026-01-01T00:00:00.000Z" }),
      lvl({ level: 2, agentId: "a2", optional: true }),
      lvl({ level: 3, agentId: "a3" }),
    ];
    expect(isApprovalLevelUnlocked(levels, 2)).toBe(true);
    expect(isApprovalLevelUnlocked(levels, 3)).toBe(true);
    const unlocked = getUnlockedIncompleteLevels(levels);
    expect(unlocked.map((l) => l.level)).toEqual([2, 3]);
    expect(getCurrentApprovalLevel(levels)?.level).toBe(2);
    expect(canApproveTravelOrderNow("a2", { status: "SUBMITTED", approvalLevels: levels })).toBe(
      true,
    );
    expect(canApproveTravelOrderNow("a3", { status: "SUBMITTED", approvalLevels: levels })).toBe(
      true,
    );
  });

  it("does not complete when only an optional level has approved", () => {
    const levels = [
      lvl({ level: 1, agentId: "a1", approvedAt: "2026-01-01T00:00:00.000Z" }),
      lvl({
        level: 2,
        agentId: "a2",
        optional: true,
        approvedAt: "2026-01-02T00:00:00.000Z",
        approvedByAgentId: "a2",
      }),
      lvl({ level: 3, agentId: "a3" }),
      lvl({ level: 4, agentId: "a4", optional: true }),
    ];
    expect(isApprovalHierarchySatisfied(levels)).toBe(false);
    // Level 4 is optional so it stays unlocked; required Level 3 is also unlocked.
    expect(getUnlockedIncompleteLevels(levels).map((l) => l.level)).toEqual([3, 4]);
  });

  it("completes when all required levels approve whether or not optionals approve", () => {
    const withOptionalPending = [
      lvl({ level: 1, agentId: "a1", approvedAt: "2026-01-01T00:00:00.000Z" }),
      lvl({ level: 2, agentId: "a2", optional: true }),
      lvl({ level: 3, agentId: "a3", approvedAt: "2026-01-03T00:00:00.000Z" }),
    ];
    expect(isApprovalHierarchySatisfied(withOptionalPending)).toBe(true);

    const withOptionalAlsoDone = [
      lvl({ level: 1, agentId: "a1", approvedAt: "2026-01-01T00:00:00.000Z" }),
      lvl({
        level: 2,
        agentId: "a2",
        optional: true,
        approvedAt: "2026-01-02T00:00:00.000Z",
        approvedByAgentId: "a2",
      }),
      lvl({ level: 3, agentId: "a3", approvedAt: "2026-01-03T00:00:00.000Z" }),
    ];
    expect(isApprovalHierarchySatisfied(withOptionalAlsoDone)).toBe(true);
  });

  it("does not let a non-assignee (including admins) approve another person's seat", () => {
    const levels = [
      lvl({ level: 1, agentId: "reginald" }),
      lvl({ level: 2, agentId: "a2", optional: true }),
      lvl({ level: 3, agentId: "a3" }),
    ];
    expect(
      canApproveTravelOrderNow("admin-other", {
        status: "SUBMITTED",
        approvalLevels: levels,
      }, { canAssignWork: true }),
    ).toBe(false);
    expect(
      getOperatorActionableApprovalLevel(levels, "admin-other", { canAssignWork: true }),
    ).toBeNull();
    expect(
      canApproveTravelOrderNow("reginald", {
        status: "SUBMITTED",
        approvalLevels: levels,
      }, { canAssignWork: true }),
    ).toBe(true);
  });

  it("does not let fellow admins confirm for the designated confirmer", () => {
    const order = {
      status: "APPROVED",
      confirmationByAgentId: "confirmer-1",
    };
    expect(
      canConfirmTravelOrderNow("admin-other", order, { canAssignWork: true }),
    ).toBe(false);
    expect(canConfirmTravelOrderNow("confirmer-1", order, { canAssignWork: true })).toBe(true);
  });
});

describe("inverted approval layer display", () => {
  it("maps the last sequence seat to Layer 2", () => {
    expect(travelOrderApprovalDisplayLayer(1, 2)).toBe(3);
    expect(travelOrderApprovalDisplayLayer(2, 2)).toBe(2);
    expect(travelOrderApprovalDisplayLayer(1, 3)).toBe(4);
    expect(travelOrderApprovalDisplayLayer(3, 3)).toBe(2);
  });

  it("sorts Layer 2 (final approver) first", () => {
    const sorted = sortTravelOrderLevelsByDisplayLayer([
      { level: 1 },
      { level: 2 },
    ]);
    expect(sorted.map((l) => l.level)).toEqual([2, 1]);
    expect(travelOrderApprovedByLabel(false, 1, 2)).toMatch(/^Layer 3/);
    expect(travelOrderApprovedByLabel(false, 2, 2)).toMatch(/^Layer 2/);
  });

  it("sizes the chain from the layer above the requestor up to Layer 2", () => {
    expect(travelOrderApprovalSeatCountFromRequestorLayer(4)).toBe(2);
    expect(travelOrderApprovalSeatCountFromRequestorLayer(3)).toBe(1);
    expect(travelOrderApprovalSeatCountFromRequestorLayer(2)).toBe(0);
    expect(travelOrderApprovalSeatCountFromRequestorLayer(1)).toBe(0);
    expect(travelOrderApprovalSeatCountFromRequestorLayer(null)).toBe(0);
    expect(travelOrderApprovalSeatCountFromRequestorLayer(undefined)).toBe(0);
    expect(travelOrderApprovalDisplayLayer(1, 2)).toBe(3);
    expect(travelOrderApprovalDisplayLayer(2, 2)).toBe(2);
  });
});

describe("offline create payload", () => {
  it("rebuilds field-assignment form fields from a draft", () => {
    const payload = travelOrderDraftToFieldAssignmentPayload({
      mainTaskName: "Site visit",
      scopedCompanyTeamId: "co-1",
      draft: {
        ...emptyTravelOrderDraft(),
        orderRequest: "Site visit",
        confirmationByAgentId: "c1",
        vehicle: "PERSONAL",
        approvalLevels: [{ level: 1, agentId: "a1", optional: false }],
        locations: [emptyTravelLocation({ label: "HQ" })],
      },
    });
    expect(payload.mainTask).toBe("Site visit");
    expect(payload.confirmationByAgentId).toBe("c1");
    expect(payload.approvalLevels).toContain("a1");
    expect(payload.scopedCompanyTeamId).toBe("co-1");
    expect(payload.locationsJson).toContain("HQ");
  });
});

describe("org-chart recommended approval path", () => {
  it("lists layers from the seat above the requestor up to Layer 2", () => {
    expect(travelOrderOrgChartLayersInApprovalPath(5)).toEqual([4, 3, 2]);
    expect(travelOrderOrgChartLayersInApprovalPath(3)).toEqual([2]);
    expect(travelOrderOrgChartLayersInApprovalPath(2)).toEqual([]);
  });

  it("marks middle seats optional when the chain has 3+ layers", () => {
    expect(travelOrderRecommendedOptionalForSeat(1, 3)).toBe(false);
    expect(travelOrderRecommendedOptionalForSeat(2, 3)).toBe(true);
    expect(travelOrderRecommendedOptionalForSeat(3, 3)).toBe(false);
    expect(travelOrderRecommendedOptionalForSeat(1, 2)).toBe(false);
  });

  it("fills seats from the org-chart ancestor path", () => {
    const seats = buildTravelOrderRecommendedPath({
      requestorOrgLayer: 5,
      ancestors: [
        {
          orgChartLayer: 4,
          agentId: "mgr4",
          agentName: "Manager Four",
          mergedSourceUserId: "m4",
        },
        {
          orgChartLayer: 2,
          agentId: "mgr2",
          agentName: "Manager Two",
          mergedSourceUserId: "m2",
        },
      ],
    });
    expect(seats).toHaveLength(3);
    expect(seats[0]).toMatchObject({
      sequenceLevel: 1,
      orgChartLayer: 4,
      agentId: "mgr4",
      recommendedOptional: false,
    });
    expect(seats[1]).toMatchObject({
      sequenceLevel: 2,
      orgChartLayer: 3,
      agentId: null,
      recommendedOptional: true,
    });
    expect(seats[2]).toMatchObject({
      sequenceLevel: 3,
      orgChartLayer: 2,
      agentId: "mgr2",
      recommendedOptional: false,
    });

    const levels = buildApprovalLevelsFromOrgChartPath(seats);
    expect(levels.map((l) => ({ level: l.level, agentId: l.agentId, optional: l.optional }))).toEqual([
      { level: 1, agentId: "mgr4", optional: false },
      { level: 2, agentId: "", optional: true },
      { level: 3, agentId: "mgr2", optional: false },
    ]);
  });

  it("merges section-head superiors ahead of people-chart parents without duplicates", () => {
    const merged = mergeTravelOrderApprovalAncestors({
      sectionHeads: [
        {
          orgChartLayer: 3,
          agentId: "engelbert",
          agentName: "Engelbert",
          mergedSourceUserId: "1687",
        },
      ],
      peopleAncestors: [
        {
          orgChartLayer: 2,
          agentId: "rocelyn",
          agentName: "Rocelyn",
          mergedSourceUserId: "1842",
        },
        {
          orgChartLayer: 3,
          agentId: "engelbert",
          agentName: "Engelbert",
          mergedSourceUserId: "1687",
        },
      ],
    });
    expect(merged.map((a) => a.agentId)).toEqual(["engelbert", "rocelyn"]);
  });

  it("builds one seat per ordered ancestor including same-layer section heads", () => {
    const seats = buildTravelOrderRecommendedPathFromChain([
      {
        orgChartLayer: 3,
        agentId: "engelbert",
        agentName: "Engelbert",
        mergedSourceUserId: "1687",
      },
      {
        orgChartLayer: 2,
        agentId: "rocelyn",
        agentName: "Rocelyn",
        mergedSourceUserId: "1842",
      },
    ]);
    expect(seats).toHaveLength(2);
    expect(seats[0]).toMatchObject({
      sequenceLevel: 1,
      agentId: "engelbert",
      orgChartLayer: 3,
      recommendedOptional: false,
    });
    expect(seats[1]).toMatchObject({
      sequenceLevel: 2,
      agentId: "rocelyn",
      orgChartLayer: 2,
      recommendedOptional: false,
    });
  });
});
