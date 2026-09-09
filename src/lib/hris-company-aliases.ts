import { COMPANY_ROSTER, type CompanyRosterName } from "@/lib/company-roster";

/**
 * Map HRIS / CSV / legacy labels onto canonical Company Board roster names.
 */
const HRIS_COMPANY_ALIASES: Record<string, CompanyRosterName> = {
  mconpinco: "MCHISI LPG",
  "m.conpinco": "MCHISI LPG",
  "m conpinco": "MCHISI LPG",
  /** Plain MCHISI is no longer on the roster — map to LPG. */
  mchisi: "MCHISI LPG",
  "mchisi lpg": "MCHISI LPG",
  "mchisi fames": "MCHISI FAMES",
  fames: "MCHISI FAMES",
  eazygaz: "EAZZYGAS",
  easygas: "EAZZYGAS",
  eazygas: "EAZZYGAS",
  eazzygas: "EAZZYGAS",
  "eazy gaz": "EAZZYGAS",
  "eazzy gas": "EAZZYGAS",
  "aci/apmc": "ACI",
  "amalgated industries": "INDUSTRIES",
  "amalgamated industries": "INDUSTRIES",
  industries: "INDUSTRIES",
};

export function resolveRosterCompanyName(
  companyName: string | null | undefined,
): CompanyRosterName | null {
  const raw = (companyName ?? "").trim();
  if (!raw) return null;

  const exact = (COMPANY_ROSTER as readonly string[]).find(
    (n) => n.toLowerCase() === raw.toLowerCase(),
  );
  if (exact) return exact as CompanyRosterName;

  const alias = HRIS_COMPANY_ALIASES[raw.toLowerCase().replace(/\s+/g, " ")];
  return alias ?? null;
}
