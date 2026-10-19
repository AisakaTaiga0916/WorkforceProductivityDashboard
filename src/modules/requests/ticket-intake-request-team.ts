import { loadCompanyDirectory } from "@/modules/platform/companies/company-directory";

/**
 * Maps free-text "Send request to" / Company/SBU to an active company.
 *
 * Matching order: directory name / code / alias → longest substring containment
 * (avoids short codes like "AGC" winning over "AGC Holdings"). Optional fallback
 * is only for legacy callers; intake should prefer `fallbackTeamId: null` so
 * unmatched text resolves to null (unassigned) instead of the creator's company.
 */
export async function resolveCustomerRequestTeam(params: {
  requestText: string;
  fallbackTeamId: string | null;
}): Promise<{ team: { id: string; name: string }; matched: boolean } | null> {
  const raw = params.requestText.trim();
  if (!raw) return null;

  const directory = await loadCompanyDirectory();
  const teams = directory.active.map((c) => ({ id: c.id, name: c.name }));

  const labelHit = directory.resolveLabel(raw);
  if (labelHit) return { team: { id: labelHit.id, name: labelHit.name }, matched: true };

  const lower = raw.toLowerCase();
  // Prefer longer company names so "AGC Holdings" beats "AGC".
  const byLengthDesc = [...teams].sort((a, b) => b.name.length - a.name.length);

  for (const t of byLengthDesc) {
    const tn = t.name.toLowerCase();
    if (tn.length >= 2 && lower.includes(tn)) return { team: t, matched: true };
  }

  for (const t of byLengthDesc) {
    const tn = t.name.toLowerCase();
    if (lower.length >= 2 && tn.includes(lower)) return { team: t, matched: true };
  }

  if (params.fallbackTeamId) {
    const fb = teams.find((t) => t.id === params.fallbackTeamId);
    if (fb) return { team: fb, matched: false };
  }

  return null;
}

/** Resolve an active company by id (Send Request To dropdown). */
export async function resolveRosterTeamById(
  teamId: string,
): Promise<{ id: string; name: string } | null> {
  const id = teamId.trim();
  if (!id) return null;
  const company = (await loadCompanyDirectory()).byId(id);
  return company?.isActive ? { id: company.id, name: company.name } : null;
}

/** Exact active company name match (case-insensitive). No fuzzy / fallback. */
export async function resolveRosterTeamByExactName(
  name: string,
): Promise<{ id: string; name: string } | null> {
  const lower = name.trim().toLowerCase();
  if (!lower) return null;
  const hit = (await loadCompanyDirectory()).active.find((c) => c.name.toLowerCase() === lower);
  return hit ? { id: hit.id, name: hit.name } : null;
}
