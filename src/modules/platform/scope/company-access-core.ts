/**
 * Pure company-access rules (no I/O) so they can be unit-tested and shared.
 *
 *   canAccessCompany(user, companyId) = user.global || membership(user, companyId)
 *
 * `global` is Super Admin (elevated platform roles): every active company plus
 * an "All companies" context. Everyone else is limited to their memberships.
 */

export const CURRENT_COMPANY_COOKIE = "wpd_company";
/** Switcher value meaning "no company filter" (global users only). */
export const ALL_COMPANIES_VALUE = "all";

export type AccessibleCompany = { id: string; name: string; isDefault: boolean };

export type CompanyAccess = {
  portalAccountId: string | null;
  global: boolean;
  /** Companies the user may switch to (all active companies when `global`), display order. */
  companies: AccessibleCompany[];
  defaultCompanyId: string | null;
  /** Current switcher context. `null` = all companies (global) or no company (no memberships). */
  currentCompanyId: string | null;
};

export function canAccessCompany(
  access: Pick<CompanyAccess, "global" | "companies">,
  companyId: string | null | undefined,
): boolean {
  if (!companyId) return false;
  return access.global || access.companies.some((c) => c.id === companyId);
}

export function encodeCompanyContextCookie(portalAccountId: string, companyId: string | null): string {
  return `${portalAccountId}:${companyId ?? ALL_COMPANIES_VALUE}`;
}

/** Cookie → `{ portalAccountId, companyId }` (`companyId: null` = all companies). */
export function decodeCompanyContextCookie(
  raw: string | null | undefined,
): { portalAccountId: string; companyId: string | null } | null {
  const value = (raw ?? "").trim();
  const sep = value.indexOf(":");
  if (sep <= 0 || sep === value.length - 1) return null;
  const portalAccountId = value.slice(0, sep);
  const company = value.slice(sep + 1);
  return { portalAccountId, companyId: company === ALL_COMPANIES_VALUE ? null : company };
}

/**
 * Current company: the remembered switcher choice when it is still allowed for
 * this account, else the default membership, else (non-global) the first
 * membership. Global users without a default open on "All companies".
 */
export function pickCurrentCompanyId(input: {
  portalAccountId: string | null;
  global: boolean;
  companies: readonly AccessibleCompany[];
  defaultCompanyId: string | null;
  cookieValue: string | null | undefined;
}): string | null {
  const remembered = decodeCompanyContextCookie(input.cookieValue);
  if (remembered && input.portalAccountId && remembered.portalAccountId === input.portalAccountId) {
    if (remembered.companyId === null) {
      if (input.global) return null;
    } else if (input.companies.some((c) => c.id === remembered.companyId)) {
      return remembered.companyId;
    }
  }
  if (input.defaultCompanyId && input.companies.some((c) => c.id === input.defaultCompanyId)) {
    return input.defaultCompanyId;
  }
  if (input.global) return null;
  return input.companies[0]?.id ?? null;
}

/**
 * Validate a membership set for User Management: unique ids, and the default
 * must be one of them (first id when omitted). Returns an error message or the
 * normalized `{ companyIds, defaultCompanyId }`.
 */
export function normalizeMembershipInput(
  companyIds: readonly string[],
  defaultCompanyId: string | null | undefined,
): { companyIds: string[]; defaultCompanyId: string | null } | { error: string } {
  const ids = [...new Set(companyIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) {
    if (defaultCompanyId) return { error: "Default company must be one of the selected companies." };
    return { companyIds: [], defaultCompanyId: null };
  }
  const def = defaultCompanyId?.trim() || ids[0];
  if (!ids.includes(def)) {
    return { error: "Default company must be one of the selected companies." };
  }
  return { companyIds: ids, defaultCompanyId: def };
}
