import { describe, expect, it } from "vitest";
import { resolveRosterCompanyName } from "@/modules/hierarchy/hris-company-aliases";

describe("company alias normalization (CO-01)", () => {
  it("maps legacy MCHISI / Easygas labels onto roster names", () => {
    expect(resolveRosterCompanyName("MCHISI")).toBe("MCHISI LPG");
    expect(resolveRosterCompanyName("easygas")).toBe("EAZZYGAS");
    expect(resolveRosterCompanyName("M.CONPINCO")).toBe("MCHISI LPG");
    expect(resolveRosterCompanyName("MCHISI FAMES")).toBe("MCHISI FAMES");
    expect(resolveRosterCompanyName("fames")).toBe("MCHISI FAMES");
  });
});
