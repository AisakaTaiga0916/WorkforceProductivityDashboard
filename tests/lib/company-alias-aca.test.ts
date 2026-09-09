import { describe, expect, it } from "vitest";
import { resolveAcaFormCompanyPrefix } from "@/lib/authority-to-conduct-activity";
import { resolveRosterCompanyName } from "@/lib/hris-company-aliases";

describe("company alias normalization (CO-01)", () => {
  it("maps legacy MCHISI / Easygas labels onto roster names", () => {
    expect(resolveRosterCompanyName("MCHISI")).toBe("MCHISI LPG");
    expect(resolveRosterCompanyName("easygas")).toBe("EAZZYGAS");
    expect(resolveRosterCompanyName("M.CONPINCO")).toBe("MCHISI LPG");
    expect(resolveRosterCompanyName("MCHISI FAMES")).toBe("MCHISI FAMES");
    expect(resolveRosterCompanyName("fames")).toBe("MCHISI FAMES");
  });

  it("ACA form prefix uses roster aliases before prefix table", () => {
    expect(resolveAcaFormCompanyPrefix("MCHISI")).toBe("MCHISI");
    expect(resolveAcaFormCompanyPrefix("MCHISI LPG")).toBe("MCHISI");
    expect(resolveAcaFormCompanyPrefix("easygas")).toBe("EAZZY");
    expect(resolveAcaFormCompanyPrefix("EAZZYGAS")).toBe("EAZZY");
  });
});
