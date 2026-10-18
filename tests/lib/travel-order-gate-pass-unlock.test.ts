import { describe, expect, it } from "vitest";
import {
  isTravelOrderConfirmReady,
  travelOrderLocationsUnlocked,
} from "@/modules/work-plans/travel-order";

describe("travel order gate pass unlock rules", () => {
  it("locks locations until Gate Pass Start when gate pass is present", () => {
    expect(
      travelOrderLocationsUnlocked({
        status: "APPROVED",
        gatePassIncluded: true,
        actualDepartureStartedAt: null,
      }),
    ).toBe(false);
    expect(
      travelOrderLocationsUnlocked({
        status: "APPROVED",
        gatePassIncluded: true,
        actualDepartureStartedAt: "2026-08-06T01:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("unlocks locations after approval when gate pass is absent", () => {
    expect(
      travelOrderLocationsUnlocked({
        status: "APPROVED",
        gatePassIncluded: false,
        actualDepartureStartedAt: null,
      }),
    ).toBe(true);
    expect(
      travelOrderLocationsUnlocked({
        status: "SUBMITTED",
        gatePassIncluded: false,
        actualDepartureStartedAt: null,
      }),
    ).toBe(false);
  });

  it("requires Gate Pass End before confirm when gate pass is present", () => {
    expect(
      isTravelOrderConfirmReady({
        status: "APPROVED",
        gatePassIncluded: true,
        actualDepartureEndedAt: null,
        locations: [
          {
            startedAt: "2026-08-06T01:00:00.000Z",
            endedAt: "2026-08-06T02:00:00.000Z",
            checkedAt: null,
          },
        ],
      }),
    ).toBe(false);
    expect(
      isTravelOrderConfirmReady({
        status: "APPROVED",
        gatePassIncluded: true,
        actualDepartureEndedAt: "2026-08-06T03:00:00.000Z",
        locations: [
          {
            startedAt: null,
            endedAt: null,
            checkedAt: null,
          },
        ],
      }),
    ).toBe(true);
  });

  it("requires all locations completed before confirm when gate pass is absent", () => {
    expect(
      isTravelOrderConfirmReady({
        status: "APPROVED",
        gatePassIncluded: false,
        actualDepartureEndedAt: null,
        locations: [
          {
            startedAt: "2026-08-06T01:00:00.000Z",
            endedAt: null,
            checkedAt: null,
          },
        ],
      }),
    ).toBe(false);
    expect(
      isTravelOrderConfirmReady({
        status: "APPROVED",
        gatePassIncluded: false,
        actualDepartureEndedAt: null,
        locations: [
          {
            startedAt: "2026-08-06T01:00:00.000Z",
            endedAt: "2026-08-06T02:00:00.000Z",
            checkedAt: null,
          },
          {
            startedAt: "2026-08-06T02:30:00.000Z",
            endedAt: "2026-08-06T03:00:00.000Z",
            checkedAt: null,
          },
        ],
      }),
    ).toBe(true);
  });
});
