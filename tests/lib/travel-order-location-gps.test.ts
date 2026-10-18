import { describe, expect, it } from "vitest";
import { isValidLatLng } from "@/modules/work-plans/travel-order";

describe("travel order location GPS rules", () => {
  it("requires both finite lat/lng in range (Start/End hard-require)", () => {
    expect(isValidLatLng(null, null)).toBe(false);
    expect(isValidLatLng(undefined, undefined)).toBe(false);
    expect(isValidLatLng(14.5995, null)).toBe(false);
    expect(isValidLatLng(null, 120.9842)).toBe(false);
    expect(isValidLatLng(Number.NaN, 120)).toBe(false);
    expect(isValidLatLng(14.5995, Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("rejects out-of-range coordinates", () => {
    expect(isValidLatLng(91, 0)).toBe(false);
    expect(isValidLatLng(-91, 0)).toBe(false);
    expect(isValidLatLng(0, 181)).toBe(false);
    expect(isValidLatLng(0, -181)).toBe(false);
  });

  it("accepts valid WGS84 positions", () => {
    expect(isValidLatLng(14.5995, 120.9842)).toBe(true);
    expect(isValidLatLng(0, 0)).toBe(true);
    expect(isValidLatLng(-33.8688, 151.2093)).toBe(true);
  });
});
