import { describe, expect, it } from "vitest";
import {
  matchCompanyByLabel,
  normalizeCompanyAliases,
  normalizeCompanyCode,
} from "@/modules/platform/companies/company-label";

/** Mirrors the rows seeded by migration 20261018120000_companies_as_data. */
const companies = [
  { id: "lpg", name: "MCHISI LPG", code: "MCHISI-LPG", aliases: ["mconpinco", "m.conpinco", "m conpinco", "mchisi"] },
  { id: "fames", name: "MCHISI FAMES", code: "MCHISI-FAMES", aliases: ["fames"] },
  { id: "gas", name: "EAZZYGAS", code: "EAZZYGAS", aliases: ["eazygaz", "easygas", "eazygas", "eazy gaz", "eazzy gas"] },
  { id: "aci", name: "ACI", code: "ACI", aliases: ["aci/apmc"] },
];

describe("company label matching (directory-driven)", () => {
  it("maps HRIS / legacy labels via directory aliases", () => {
    expect(matchCompanyByLabel("MCHISI", companies)?.name).toBe("MCHISI LPG");
    expect(matchCompanyByLabel("easygas", companies)?.name).toBe("EAZZYGAS");
    expect(matchCompanyByLabel("M.CONPINCO", companies)?.name).toBe("MCHISI LPG");
    expect(matchCompanyByLabel("MCHISI FAMES", companies)?.name).toBe("MCHISI FAMES");
    expect(matchCompanyByLabel("fames", companies)?.name).toBe("MCHISI FAMES");
  });

  it("matches by code and ignores case / extra whitespace", () => {
    expect(matchCompanyByLabel("mchisi-lpg", companies)?.id).toBe("lpg");
    expect(matchCompanyByLabel("  eazy   gaz ", companies)?.id).toBe("gas");
  });

  it("prefers exact name over alias and returns null when nothing matches", () => {
    expect(matchCompanyByLabel("ACI", companies)?.id).toBe("aci");
    expect(matchCompanyByLabel("Unknown Holdings", companies)).toBeNull();
    expect(matchCompanyByLabel("", companies)).toBeNull();
  });

  it("normalizes aliases and codes for storage", () => {
    expect(normalizeCompanyAliases([" Fames ", "fames", "", "MCHISI  Fames"])).toEqual([
      "fames",
      "mchisi fames",
    ]);
    expect(normalizeCompanyCode(" mchisi lpg ")).toBe("MCHISI-LPG");
    expect(normalizeCompanyCode("  ")).toBeNull();
  });
});
