import { prisma } from "@/modules/platform/db/prisma";
import { COMPANY_ROSTER, rosterTeamNameFilter, sortByRosterOrder } from "@/lib/company-roster";

/**
 * Maps free-text "Send request to" / Company/SBU to a roster Team row.
 *
 * Matching order: exact name → longest substring containment (avoids short
 * codes like "AGC" winning over "AGC Holdings"). Optional fallback is only for
 * legacy callers; intake should prefer `fallbackTeamId: null` so unmatched
 * text routes to OUTSIDE COMPANY instead of the creator's company.
 */
export async function resolveCustomerRequestTeam(params: {
  requestText: string;
  fallbackTeamId: string | null;
}): Promise<{ team: { id: string; name: string }; matched: boolean } | null> {
  const raw = params.requestText.trim();
  if (!raw) return null;

  const teams = sortByRosterOrder(
    await prisma.team.findMany({
      where: rosterTeamNameFilter(),
      select: { id: true, name: true },
    }),
  );

  const lower = raw.toLowerCase();

  const exact = teams.find((t) => t.name.toLowerCase() === lower);
  if (exact) return { team: exact, matched: true };

  // Prefer longer roster names so "AGC Holdings" beats "AGC".
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

/** Resolve a roster team by id (Send Request To dropdown). */
export async function resolveRosterTeamById(
  teamId: string,
): Promise<{ id: string; name: string } | null> {
  const id = teamId.trim();
  if (!id) return null;
  const team = await prisma.team.findUnique({
    where: { id },
    select: { id: true, name: true },
  });
  if (!team || !(COMPANY_ROSTER as readonly string[]).includes(team.name)) {
    return null;
  }
  return team;
}

/** Exact roster name match (case-insensitive). No fuzzy / fallback. */
export async function resolveRosterTeamByExactName(
  name: string,
): Promise<{ id: string; name: string } | null> {
  const raw = name.trim();
  if (!raw) return null;
  const teams = await prisma.team.findMany({
    where: rosterTeamNameFilter(),
    select: { id: true, name: true },
  });
  const lower = raw.toLowerCase();
  return teams.find((t) => t.name.toLowerCase() === lower) ?? null;
}
