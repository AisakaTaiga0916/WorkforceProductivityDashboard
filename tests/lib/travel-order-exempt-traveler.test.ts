import { describe, expect, it } from "vitest";
import {
  normalizeTravelerAgentIds,
  parseTravelerAgentIds,
  validateTravelOrderDraft,
  emptyTravelOrderDraft,
} from "@/modules/work-plans/travel-order";

describe("exempt requester from travelers", () => {
  it("omits the requestor when exempt is enabled", () => {
    expect(
      normalizeTravelerAgentIds({
        createdByAgentId: "creator-1",
        additionalTravelerAgentIds: ["a", "b", "creator-1"],
        exemptRequesterFromTravelers: true,
      }),
    ).toEqual(["a", "b"]);
  });

  it("keeps the requestor when exempt is off", () => {
    expect(
      normalizeTravelerAgentIds({
        createdByAgentId: "creator-1",
        additionalTravelerAgentIds: ["a"],
        exemptRequesterFromTravelers: false,
      }),
    ).toEqual(["creator-1", "a"]);
  });

  it("does not force-add creator when stored travelers omit them", () => {
    expect(parseTravelerAgentIds(["a", "b"], "creator-1")).toEqual(["a", "b"]);
  });

  it("requires at least one traveler when exempt", () => {
    const draft = {
      ...emptyTravelOrderDraft(),
      orderRequest: "Site visit",
      approvedByAgentIds: ["approver-1"],
      confirmationByAgentId: "confirm-1",
      vehicle: "COMPANY_VAN" as const,
      exemptRequesterFromTravelers: true,
      additionalTravelerAgentIds: [] as string[],
      locations: [
        {
          clientKey: "1",
          label: "HQ",
          latitude: null,
          longitude: null,
          remarks: "",
          attachments: [],
        },
      ],
    };
    expect(validateTravelOrderDraft(draft)).toMatch(/Exempt Me from Travelers/i);
    draft.additionalTravelerAgentIds = ["traveler-1"];
    expect(validateTravelOrderDraft(draft)).toBeNull();
  });
});
