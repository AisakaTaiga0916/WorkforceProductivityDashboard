/**
 * Match org-chart section names that represent HR (Human Resources).
 * Uses exact allowlist + whole-word "hr" tokens — not substring includes
 * (which falsely matched Chair, Shareholder, Architecture, etc.).
 */
const HR_SECTION_NAME_EXACT = new Set([
  "hr",
  "hr team",
  "human resources",
  "human resource",
  "human resource management",
]);

export function isHrSectionName(name: string | null | undefined): boolean {
  const n = (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!n) return false;
  if (HR_SECTION_NAME_EXACT.has(n)) return true;
  // Whole-word token match: "Corporate HR", "People & HR Team"
  const tokens = n.split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.includes("hr")) return true;
  // Multi-word phrase without requiring exact full-string match
  if (/\bhuman\s+resources?\b/.test(n)) return true;
  return false;
}
