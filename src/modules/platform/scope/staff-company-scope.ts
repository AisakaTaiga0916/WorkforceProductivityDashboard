import { rosterTeamNameFilter } from "@/lib/company-roster";
import { resolveRosterCompanyName } from "@/modules/hierarchy/hris-company-aliases";
import { loadCompanyNamesBySourceUserId } from "@/lib/merged-duty-status";
import { prisma } from "@/modules/platform/db/prisma";

/**
 * Company a staff member works under for task assignment / grouping.
 * `id` is the primary roster Team id when the company matches one, otherwise
 * null (merged-only companies still group by `name`).
 */
export type EffectiveAssignmentCompany = { id: string | null; name: string };

type PortalCompanyRow = {
  email: string;
  mergedSourceUserId: bigint | null;
  staffDesignatedCompany: { id: string; name: string } | null;
};

async function loadRosterTeamsByName(): Promise<Map<string, { id: string; name: string }>> {
  const teams = await prisma.team.findMany({
    where: rosterTeamNameFilter(),
    select: { id: true, name: true },
  });
  return new Map(teams.map((t) => [t.name.trim().toLowerCase(), t] as const));
}

/**
 * Effective assignment company per portal, keyed by lowercased email.
 * The merge DB `company_name` (personnel-tab source of truth) wins and is
 * resolved back to the primary roster Team so id-based company filters keep
 * working; the portal's designated company is only a fallback for legacy rows.
 */
export async function loadEffectiveCompaniesByPortalEmail(
  portals: ReadonlyArray<PortalCompanyRow>,
): Promise<Map<string, EffectiveAssignmentCompany | null>> {
  const sourceIds = portals
    .map((p) => p.mergedSourceUserId)
    .filter((id): id is bigint => id != null);
  const [mergedNames, teamsByName] = await Promise.all([
    sourceIds.length > 0
      ? loadCompanyNamesBySourceUserId(sourceIds)
      : Promise.resolve(new Map<string, string | null>()),
    loadRosterTeamsByName(),
  ]);

  const out = new Map<string, EffectiveAssignmentCompany | null>();
  for (const portal of portals) {
    const email = portal.email.trim().toLowerCase();
    if (!email || out.has(email)) continue;

    const mergedRaw =
      portal.mergedSourceUserId != null
        ? mergedNames.get(portal.mergedSourceUserId.toString())?.trim()
        : undefined;
    if (mergedRaw) {
      const canonical = resolveRosterCompanyName(mergedRaw) ?? mergedRaw;
      const team = teamsByName.get(canonical.toLowerCase());
      out.set(email, team ? { id: team.id, name: team.name } : { id: null, name: canonical });
      continue;
    }

    out.set(
      email,
      portal.staffDesignatedCompany
        ? { id: portal.staffDesignatedCompany.id, name: portal.staffDesignatedCompany.name }
        : null,
    );
  }
  return out;
}

const PORTAL_COMPANY_SELECT = {
  email: true,
  mergedSourceUserId: true,
  staffDesignatedCompany: { select: { id: true, name: true } },
} as const;

/**
 * Staff portals for company resolution, including LEGACY_CONFLICT rows (old
 * work emails that still own tickets/KPIs). Canonical (non-legacy) portals are
 * sorted first so first-wins email/name maps prefer them.
 */
async function loadStaffPortalsForCompanyResolution() {
  const portals = await prisma.portalAccount.findMany({
    where: { role: { in: ["Admin", "Personnel"] } },
    select: { ...PORTAL_COMPANY_SELECT, name: true, accountStatus: true },
  });
  return portals.sort(
    (a, b) =>
      (a.accountStatus === "LEGACY_CONFLICT" ? 1 : 0) -
      (b.accountStatus === "LEGACY_CONFLICT" ? 1 : 0),
  );
}

type CompanyIdResolution = {
  byEmail: Map<string, string | null>;
  byName: Map<string, string | null>;
};

/**
 * Company Team id per portal email and per person name. A person's canonical
 * (ACTIVE, merged-linked) portal wins, so legacy emails of the same person
 * count toward the company the personnel tab shows.
 */
async function buildCompanyIdResolution(
  portals: Awaited<ReturnType<typeof loadStaffPortalsForCompanyResolution>>,
): Promise<CompanyIdResolution> {
  const effective = await loadEffectiveCompaniesByPortalEmail(portals);

  const byName = new Map<string, string | null>();
  for (const portal of portals) {
    const nameKey = portal.name.trim().toLowerCase();
    if (!nameKey || byName.has(nameKey)) continue;
    const company =
      effective.get(portal.email.trim().toLowerCase())?.id ??
      portal.staffDesignatedCompany?.id ??
      null;
    byName.set(nameKey, company);
  }

  const byEmail = new Map<string, string | null>();
  for (const portal of portals) {
    const email = portal.email.trim().toLowerCase();
    if (!email || byEmail.has(email)) continue;
    const canonicalByName = byName.get(portal.name.trim().toLowerCase()) ?? null;
    const own =
      effective.get(email)?.id ?? portal.staffDesignatedCompany?.id ?? null;
    byEmail.set(email, canonicalByName ?? own);
  }

  return { byEmail, byName };
}

/**
 * Primary Agent ids belonging to the company (merged-first, matching the
 * personnel tab), including agent rows reached only via legacy emails or a
 * same-name portal. Use for scoping metrics/boards by company.
 */
export async function loadAgentIdsForCompanyTeam(companyTeamId: string): Promise<string[]> {
  const [portals, agents] = await Promise.all([
    loadStaffPortalsForCompanyResolution(),
    prisma.agent.findMany({ select: { id: true, email: true, name: true } }),
  ]);
  const { byEmail, byName } = await buildCompanyIdResolution(portals);

  const ids: string[] = [];
  for (const agent of agents) {
    const email = agent.email.trim().toLowerCase();
    const nameKey = agent.name.trim().toLowerCase();
    const companyId = byEmail.get(email) ?? byName.get(nameKey) ?? null;
    if (companyId === companyTeamId) ids.push(agent.id);
  }
  return ids;
}

async function effectiveCompanyIdForEmail(email: string): Promise<string | null> {
  const portals = await prisma.portalAccount.findMany({
    where: { email: { equals: email, mode: "insensitive" } },
    select: PORTAL_COMPANY_SELECT,
  });
  if (portals.length === 0) return null;
  const effective = await loadEffectiveCompaniesByPortalEmail(portals);
  const company = effective.get(email.trim().toLowerCase());
  if (company?.id) return company.id;
  // Merged company with no roster Team (or no company at all): keep id-based
  // scoping stable via the portal's designated company.
  return portals.find((p) => p.staffDesignatedCompany)?.staffDesignatedCompany?.id ?? null;
}

/**
 * Company (roster Team id) for an agent, with same-name portal-linked peer
 * fallback. Merged-database company assignment wins over the portal's
 * designated company so task scoping follows the personnel tab.
 */
export async function resolveAgentDesignatedCompanyId(agentId: string): Promise<string | null> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { id: true, email: true, name: true, teamId: true },
  });
  if (!agent) return null;

  const email = agent.email.trim().toLowerCase();
  if (email) {
    const companyId = await effectiveCompanyIdForEmail(email);
    if (companyId) return companyId;
  }

  const name = agent.name.trim();
  if (name) {
    const peers = await prisma.agent.findMany({
      where: {
        name: { equals: name, mode: "insensitive" },
        NOT: { id: agent.id },
      },
      select: { email: true },
      take: 10,
    });
    for (const peer of peers) {
      const peerEmail = peer.email.trim().toLowerCase();
      if (!peerEmail) continue;
      const companyId = await effectiveCompanyIdForEmail(peerEmail);
      if (companyId) return companyId;
    }
  }

  // Last resort: primary agent roster team (same fallback as resolveStaffCompanyTeamId).
  return agent.teamId ?? null;
}

/**
 * Company queue (Team id) used to scope Admin assignment / board visibility.
 * Prefers the merged-database company (personnel tab), then the portal's
 * designated company, then the agent roster team.
 */
export async function resolveStaffCompanyTeamId(email: string | null | undefined): Promise<string | null> {
  const e = (email ?? "").trim().toLowerCase();
  if (!e) return null;
  const companyId = await effectiveCompanyIdForEmail(e);
  if (companyId) return companyId;
  const agent = await prisma.agent.findFirst({
    where: { email: { equals: e, mode: "insensitive" } },
    select: { teamId: true },
  });
  return agent?.teamId ?? null;
}

/**
 * Roster company display name for an Admin's assigned company.
 * Returns null when the user is not company-scoped (e.g. SuperAdmin) or has no assignment.
 * Pass `forceNone: true` to get `"__none__"` when Admin has no company (empty filter match).
 */
export async function resolveAdminOnDutyCompanyFilter(
  role: string | null | undefined,
  email: string | null | undefined,
  options?: { forceNone?: boolean },
): Promise<string | null> {
  if (role !== "Admin") return null;
  const teamId = await resolveStaffCompanyTeamId(email);
  if (!teamId) return options?.forceNone === false ? null : "__none__";
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { name: true },
  });
  const name = team?.name?.trim();
  if (name) return name;
  return options?.forceNone === false ? null : "__none__";
}
