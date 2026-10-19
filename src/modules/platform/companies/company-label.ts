/**
 * Pure company-label helpers (client-safe). The company directory itself lives in
 * the database (`teams` table, Prisma model `Company`); see `company-directory.ts`.
 */

export type CompanyLabelRecord = {
  id: string;
  name: string;
  code: string | null;
  aliases: readonly string[];
};

/** Trim, collapse whitespace, lowercase. */
export function normalizeCompanyLabel(raw: string | null | undefined): string {
  return (raw ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Normalize an alias list for storage: unique, non-empty, lowercased. */
export function normalizeCompanyAliases(aliases: readonly string[]): string[] {
  const out = new Set<string>();
  for (const alias of aliases) {
    const key = normalizeCompanyLabel(alias);
    if (key) out.add(key);
  }
  return [...out];
}

/**
 * Resolve an HRIS / CSV / free-text company label to a directory entry:
 * exact name, then code, then alias (all case/whitespace-insensitive).
 */
export function matchCompanyByLabel<T extends CompanyLabelRecord>(
  raw: string | null | undefined,
  companies: readonly T[],
): T | null {
  const key = normalizeCompanyLabel(raw);
  if (!key) return null;
  return (
    companies.find((c) => normalizeCompanyLabel(c.name) === key) ??
    companies.find((c) => c.code != null && normalizeCompanyLabel(c.code) === key) ??
    companies.find((c) => c.aliases.some((a) => normalizeCompanyLabel(a) === key)) ??
    null
  );
}

export function compareCompanyOrder(
  a: { sortOrder: number; name: string },
  b: { sortOrder: number; name: string },
): number {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
}

/** Normalize a user-entered company code: trimmed, uppercased, spaces → dashes. */
export function normalizeCompanyCode(raw: string | null | undefined): string | null {
  const code = (raw ?? "").trim().toUpperCase().replace(/\s+/g, "-");
  return code || null;
}
