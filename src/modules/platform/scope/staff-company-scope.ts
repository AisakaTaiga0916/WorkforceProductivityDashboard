import type { Session } from "next-auth";
import { loadCompanyNamesBySourceUserId } from "@/lib/merged-duty-status";
import { isElevatedPlatformRole } from "@/lib/staff-role";
import { prisma } from "@/modules/platform/db/prisma";
import { loadCompanyDirectory } from "@/modules/platform/companies/company-directory";
import { getCompanyAccess } from "@/modules/platform/scope/company-access";

/**
 * A person's company for assignment / grouping: their **default membership**
 * (`user_companies`, mirrored on `staffDesignatedCompanyId`). Accounts without a
 * membership fall back to their HRIS company label. `id` is null when the label
 * matches no company in the directory.
 *
 * Viewer-scoped code must use `resolveViewerCompanyId(session)` (switcher context)
 * instead of resolving the viewer's own email here.
 */
export type EffectiveAssignmentCompany = { id: string | null; name: string };

type PortalCompanyRow = {
  email: string;
  mergedSourceUserId: bigint | null;
  staffDesignatedCompany: { id: string; name: string } | null;
};

/**
 * Default company per portal, keyed by lowercased email: default membership
 * first, HRIS company label (resolved through the directory) as a fallback.
 */
export async function loadEffectiveCompaniesByPortalEmail(
  portals: ReadonlyArray<PortalCompanyRow>,
): Promise<Map<string, EffectiveAssignmentCompany | null>> {
  const needsHris = portals
    .filter((p) => !p.staffDesignatedCompany && p.mergedSourceUserId != null)
    .map((p) => p.mergedSourceUserId as bigint);
  const [mergedNames, directory] = await Promise.all([
    needsHris.length > 0
      ? loadCompanyNamesBySourceUserId(needsHris)
      : Promise.resolve(new Map<string, string | null>()),
    loadCompanyDirectory(),
  ]);

  const out = new Map<string, EffectiveAssignmentCompany | null>();
  for (const portal of portals) {
    const email = portal.email.trim().toLowerCase();
    if (!email || out.has(email)) continue;

    if (portal.staffDesignatedCompany) {
      out.set(email, { id: portal.staffDesignatedCompany.id, name: portal.staffDesignatedCompany.name });
      continue;
    }
    const mergedRaw =
      portal.mergedSourceUserId != null
        ? mergedNames.get(portal.mergedSourceUserId.toString())?.trim()
        : undefined;
    if (mergedRaw) {
      const company = directory.resolveLabel(mergedRaw);
      out.set(email, company ? { id: company.id, name: company.name } : { id: null, name: mergedRaw });
      continue;
    }
    out.set(email, null);
  }
  return out;
}

const PORTAL_COMPANY_SELECT = {
  email: true,
  mergedSourceUserId: true,
  staffDesignatedCompany: { select: { id: true, name: true } },
  companyMemberships: { select: { companyId: true } },
} as const;

/**
 * Staff portals for company resolution, including LEGACY_CONFLICT rows (old
 * work emails that still own tickets/KPIs). Canonical (non-legacy) portals are
 * sorted first so first-wins email/name maps prefer them.
 */
async function loadStaffPortalsForCompanyResolution() {
  const portals = await prisma.portalAccount.findMany({
    where: { NOT: { role: "Customer", roleId: null } },
    select: { ...PORTAL_COMPANY_SELECT, name: true, accountStatus: true },
  });
  return portals.sort(
    (a, b) =>
      (a.accountStatus === "LEGACY_CONFLICT" ? 1 : 0) -
      (b.accountStatus === "LEGACY_CONFLICT" ? 1 : 0),
  );
}

type CompanySetResolution = {
  byEmail: Map<string, ReadonlySet<string>>;
  byName: Map<string, ReadonlySet<string>>;
};

/**
 * Every company a person belongs to, per portal email and per person name. A
 * person's canonical (ACTIVE) portal wins, so legacy emails of the same person
 * count toward that person's companies.
 */
async function buildCompanySetResolution(
  portals: Awaited<ReturnType<typeof loadStaffPortalsForCompanyResolution>>,
): Promise<CompanySetResolution> {
  const effective = await loadEffectiveCompaniesByPortalEmail(portals);
  const companiesFor = (portal: (typeof portals)[number]): Set<string> => {
    const ids = new Set(portal.companyMemberships.map((m) => m.companyId));
    const fallback = effective.get(portal.email.trim().toLowerCase())?.id;
    if (ids.size === 0 && fallback) ids.add(fallback);
    return ids;
  };

  const byName = new Map<string, ReadonlySet<string>>();
  for (const portal of portals) {
    const nameKey = portal.name.trim().toLowerCase();
    if (!nameKey || byName.has(nameKey)) continue;
    byName.set(nameKey, companiesFor(portal));
  }

  const byEmail = new Map<string, ReadonlySet<string>>();
  for (const portal of portals) {
    const email = portal.email.trim().toLowerCase();
    if (!email || byEmail.has(email)) continue;
    const canonical = byName.get(portal.name.trim().toLowerCase());
    byEmail.set(email, canonical && canonical.size > 0 ? canonical : companiesFor(portal));
  }
  return { byEmail, byName };
}

/**
 * Primary Agent ids of everyone who **shares** the company (any membership),
 * including agent rows reached only via legacy emails or a same-name portal.
 * Use for assignee pickers and for scoping metrics/boards by company.
 */
export async function loadAgentIdsForCompanyTeam(companyTeamId: string): Promise<string[]> {
  const [portals, agents] = await Promise.all([
    loadStaffPortalsForCompanyResolution(),
    prisma.agent.findMany({ select: { id: true, email: true, name: true } }),
  ]);
  const { byEmail, byName } = await buildCompanySetResolution(portals);

  const ids: string[] = [];
  for (const agent of agents) {
    const companies =
      byEmail.get(agent.email.trim().toLowerCase()) ?? byName.get(agent.name.trim().toLowerCase());
    if (companies?.has(companyTeamId)) ids.push(agent.id);
  }
  return ids;
}

async function defaultCompanyIdForEmail(email: string): Promise<string | null> {
  const portals = await prisma.portalAccount.findMany({
    where: { email: { equals: email, mode: "insensitive" } },
    select: PORTAL_COMPANY_SELECT,
  });
  if (portals.length === 0) return null;
  const effective = await loadEffectiveCompaniesByPortalEmail(portals);
  return effective.get(email.trim().toLowerCase())?.id ?? null;
}

/**
 * Default company for an agent, with same-name portal-linked peer fallback,
 * then the agent roster company.
 */
export async function resolveAgentDesignatedCompanyId(agentId: string): Promise<string | null> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { id: true, email: true, name: true, teamId: true },
  });
  if (!agent) return null;

  const email = agent.email.trim().toLowerCase();
  if (email) {
    const companyId = await defaultCompanyIdForEmail(email);
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
      const companyId = await defaultCompanyIdForEmail(peerEmail);
      if (companyId) return companyId;
    }
  }

  return agent.teamId ?? null;
}

/** Every company id an agent's person belongs to (memberships; default-company fallback). */
export async function resolveAgentCompanyIds(agentId: string): Promise<string[]> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { email: true },
  });
  if (!agent) return [];
  const rows = await prisma.userCompany.findMany({
    where: { portalAccount: { email: { equals: agent.email.trim(), mode: "insensitive" } } },
    select: { companyId: true },
  });
  if (rows.length > 0) return [...new Set(rows.map((r) => r.companyId))];
  const fallback = await resolveAgentDesignatedCompanyId(agentId);
  return fallback ? [fallback] : [];
}

/**
 * Default company of a person (by email): default membership, then HRIS company,
 * then agent roster company. Not the viewer's switcher context.
 */
export async function resolveStaffCompanyTeamId(email: string | null | undefined): Promise<string | null> {
  const e = (email ?? "").trim().toLowerCase();
  if (!e) return null;
  const companyId = await defaultCompanyIdForEmail(e);
  if (companyId) return companyId;
  const agent = await prisma.agent.findFirst({
    where: { email: { equals: e, mode: "insensitive" } },
    select: { teamId: true },
  });
  return agent?.teamId ?? null;
}

/** Every company a person (by email) belongs to; default-company fallback for legacy rows. */
export async function resolveStaffCompanyIds(email: string | null | undefined): Promise<string[]> {
  const e = (email ?? "").trim().toLowerCase();
  if (!e) return [];
  const rows = await prisma.userCompany.findMany({
    where: { portalAccount: { email: { equals: e, mode: "insensitive" } } },
    select: { companyId: true },
  });
  if (rows.length > 0) return [...new Set(rows.map((r) => r.companyId))];
  const fallback = await resolveStaffCompanyTeamId(e);
  return fallback ? [fallback] : [];
}

/**
 * On-duty company filter (company name) for the viewer. Non-global staff are
 * locked to their current company (`"__none__"` when they have none); global
 * users get `null` (free filter).
 */
export async function resolveViewerOnDutyCompanyFilter(
  session: Session | null | undefined,
): Promise<string | null> {
  if (isElevatedPlatformRole(session?.user?.role)) return null;
  const access = await getCompanyAccess(session);
  const current = access.companies.find((c) => c.id === access.currentCompanyId);
  return current?.name ?? "__none__";
}
