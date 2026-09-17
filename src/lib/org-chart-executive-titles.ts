/**
 * Executive display titles for org-chart leaders (sidebar designation + chart tags).
 * Keyed by merged HRIS id; name matching is a fallback only.
 */
const EXECUTIVE_TITLE_BY_MERGED_ID: Record<string, string> = {
  "1676": "CEO", // Manuel Go Uykimpang Iii
  "1842": "COO", // Cortez, Rocelyn Gantilis
};

function normalizePersonKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const EXECUTIVE_TITLE_BY_NAME: Array<{ match: RegExp; title: string }> = [
  { match: /\bmanuel\b.*\bgo\b|\bgo\b.*\bmanuel\b/i, title: "CEO" },
  { match: /\brocelyn\b.*\bcortez\b|\bcortez\b.*\brocelyn\b/i, title: "COO" },
];

export function resolveExecutiveTitle(input: {
  mergedSourceUserId?: string | null;
  personName?: string | null;
}): string | null {
  const merged = String(input.mergedSourceUserId ?? "").trim();
  if (merged && EXECUTIVE_TITLE_BY_MERGED_ID[merged]) {
    return EXECUTIVE_TITLE_BY_MERGED_ID[merged]!;
  }
  const name = (input.personName ?? "").trim();
  if (!name) return null;
  const key = normalizePersonKey(name);
  for (const row of EXECUTIVE_TITLE_BY_NAME) {
    if (row.match.test(key) || row.match.test(name)) return row.title;
  }
  return null;
}

/** Collapse "COO · COO" / repeated tokens into a single label. */
export function collapseDuplicateDesignation(
  label: string | null | undefined,
): string {
  const raw = (label ?? "").trim();
  if (!raw) return "";
  const parts = raw
    .split(/\s*(?:·|•|,)\s*|\s+-\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const part of parts) {
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(part);
  }
  return unique.join(" · ");
}

/** Sidebar department line: prefer title, then append scoped departments when present. */
export function formatDepartmentDesignationWithExecutiveTitle(
  executiveTitle: string | null | undefined,
  departmentScopeLabel: string | null | undefined,
): string | null {
  const title = (executiveTitle ?? "").trim();
  const scope = collapseDuplicateDesignation(departmentScopeLabel);
  if (title && scope && title.toLowerCase() === scope.toLowerCase()) return title;
  if (title && scope) return collapseDuplicateDesignation(`${title} · ${scope}`);
  if (title) return title;
  if (scope) return scope;
  return null;
}
