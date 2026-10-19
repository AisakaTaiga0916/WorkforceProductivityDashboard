/**
 * HRIS-first staff roster for Assignment board, Task board assignees, and Activities.
 * People come from the main-DB `hris_users` snapshot (filled by the merged-dump import);
 * company = default membership (User Management), else the HRIS company.
 * Portal/Agent rows are attached when present; Agent rows are created on demand so boards
 * can assign work.
 */
import { pickCanonicalAgentForPortal } from "@/lib/admin-roster";
import { resolveHrisSourceTags } from "@/lib/merged-database-sources";
import { matchPersonnelCompanyTeam } from "@/lib/personnel-accounts-data";
import { prisma } from "@/modules/platform/db/prisma";
import { withTtlCache } from "@/lib/ttl-cache";
import {
  ACTIVE_COMPANY_WHERE,
  COMPANY_ORDER_BY,
} from "@/modules/platform/companies/company-directory";
import { isStaffPortalRole, normalizePortalRole } from "@/lib/staff-role";
import type { EffectiveAssignmentCompany } from "@/modules/platform/scope/staff-company-scope";
import {
  buildCanonicalMergedIdMap,
  canonicalMergedId,
} from "@/lib/sync/merged-person-identity";
import { Prisma } from "@prisma/client/primary";

export type HrisAssignableStaff = {
  mergedSourceUserId: string;
  agentId: string;
  name: string;
  email: string;
  portalRole: string | null;
  headPrivileges: boolean;
  assignmentCompany: EffectiveAssignmentCompany | null;
  teamLabel: string;
};

type MergedRosterRow = {
  source_user_id: bigint;
  name: string;
  email: string | null;
  username: string | null;
  role: string;
  company_name: string | null;
  source_database: string;
};

function syntheticEmail(sourceUserId: string, username: string | null): string {
  const u = username?.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "") || sourceUserId;
  return `${u}@hris.merged`;
}

/**
 * Load active HRIS people from the `hris_users` snapshot and ensure each has a primary Agent id
 * (create Agent under their Personnel-tab company Team when missing).
 */
export async function loadHrisAssignableStaff(options?: {
  /** Limit to one roster Team id (same company grouping as the Personnel tab). */
  companyTeamId?: string | null;
  /** Skip HRIS super_admin rows (default true — matches Personnel / Activities). */
  excludeHrisSuperAdmin?: boolean;
}): Promise<HrisAssignableStaff[]> {
  const excludeSuper = options?.excludeHrisSuperAdmin !== false;
  const companyTeamId = options?.companyTeamId?.trim() || null;
  return withTtlCache(
    `hris-assignable-staff:v3:${companyTeamId ?? "all"}:${excludeSuper ? "1" : "0"}`,
    60_000,
    () => loadHrisAssignableStaffUncached({ companyTeamId, excludeSuper }),
  );
}

async function loadHrisAssignableStaffUncached(options: {
  companyTeamId: string | null;
  excludeSuper: boolean;
}): Promise<HrisAssignableStaff[]> {
  const excludeSuper = options.excludeSuper;
  const companyTeamId = options.companyTeamId;
  const sourceTags = resolveHrisSourceTags();

  const [mergedRows, teams, portals, agents] = await Promise.all([
    prisma.$queryRaw<MergedRosterRow[]>`
      SELECT source_user_id, name, email, username, role, company_name, source_database
      FROM hris_users
      WHERE is_active = true
        AND source_database IN (${Prisma.join(sourceTags)})
      ORDER BY name ASC
    `,
    prisma.company.findMany({
      where: ACTIVE_COMPANY_WHERE,
      orderBy: COMPANY_ORDER_BY,
      select: { id: true, name: true, code: true, aliases: true },
    }),
    prisma.portalAccount.findMany({
      where: { mergedSourceUserId: { not: null } },
      select: {
        email: true,
        name: true,
        role: true,
        headPrivileges: true,
        mergedSourceUserId: true,
        accountStatus: true,
        staffDesignatedCompanyId: true,
        companyMemberships: { select: { companyId: true } },
      },
    }),
    prisma.agent.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, email: true, name: true, createdAt: true, teamId: true },
    }),
  ]);

  const canonicalMap = buildCanonicalMergedIdMap(
    mergedRows.map((r) => ({
      sourceUserId: r.source_user_id,
      name: r.name,
      email: r.email,
    })),
  );

  const portalByCanonicalId = new Map<string, (typeof portals)[number]>();
  for (const p of portals) {
    if (p.mergedSourceUserId == null) continue;
    if (p.accountStatus === "LEGACY_CONFLICT") continue;
    const key = canonicalMergedId(p.mergedSourceUserId, canonicalMap).toString();
    const existing = portalByCanonicalId.get(key);
    if (!existing || (isStaffPortalRole(p.role) && !isStaffPortalRole(existing.role))) {
      portalByCanonicalId.set(key, p);
    }
  }

  const agentByEmail = new Map(
    agents.map((a) => [a.email.trim().toLowerCase(), a] as const),
  );
  let mutableAgents = [...agents];

  const out: HrisAssignableStaff[] = [];
  const seenAgentIds = new Set<string>();

  for (const row of mergedRows) {
    if (excludeSuper && row.role === "super_admin") continue;

    const sourceKey = row.source_user_id.toString();
    const portal = portalByCanonicalId.get(sourceKey) ?? null;
    // Same rule as the Personnel tab: app-assigned company first, then the HRIS company.
    const designatedTeam = portal?.staffDesignatedCompanyId
      ? teams.find((t) => t.id === portal.staffDesignatedCompanyId) ?? null
      : null;
    const matched = designatedTeam
      ? { teamId: designatedTeam.id, teamName: designatedTeam.name }
      : matchPersonnelCompanyTeam(row.company_name, teams);
    const assignmentTeam =
      designatedTeam ??
      (matched.teamId.startsWith("company:")
        ? null
        : teams.find((t) => t.id === matched.teamId) ?? null);

    if (companyTeamId) {
      // Shares the company: any membership, else the resolved default company.
      const memberOf = portal?.companyMemberships.some((m) => m.companyId === companyTeamId) ?? false;
      if (!memberOf && assignmentTeam?.id !== companyTeamId) continue;
    }

    const teamForAgentRow = assignmentTeam;

    const email =
      (row.email ?? "").trim().toLowerCase() ||
      portal?.email.trim().toLowerCase() ||
      syntheticEmail(sourceKey, row.username);

    const candidates = [
      { email, name: row.name },
      ...(portal ? [{ email: portal.email, name: portal.name }] : []),
    ];

    let agent =
      candidates
        .map((c) => pickCanonicalAgentForPortal(c, mutableAgents))
        .find((a): a is NonNullable<typeof a> => a != null) ?? null;

    if (!agent && teamForAgentRow) {
      try {
        const created = await prisma.agent.create({
          data: {
            name: row.name,
            email,
            teamId: teamForAgentRow.id,
          },
          select: { id: true, email: true, name: true, createdAt: true, teamId: true },
        });
        agent = created;
        mutableAgents.push(created);
        agentByEmail.set(email, created);
      } catch {
        agent = agentByEmail.get(email) ?? null;
        if (!agent) {
          const refreshed = await prisma.agent.findMany({
            orderBy: { createdAt: "asc" },
            select: { id: true, email: true, name: true, createdAt: true, teamId: true },
          });
          mutableAgents = refreshed;
          agent = pickCanonicalAgentForPortal({ email, name: row.name }, refreshed);
        }
      }
    }

    if (!agent) continue;
    if (seenAgentIds.has(agent.id)) continue;
    seenAgentIds.add(agent.id);

    if (assignmentTeam && agent.teamId !== assignmentTeam.id) {
      await prisma.agent
        .update({ where: { id: agent.id }, data: { teamId: assignmentTeam.id } })
        .catch(() => null);
    }

    const assignmentCompany: EffectiveAssignmentCompany | null = assignmentTeam
      ? { id: assignmentTeam.id, name: assignmentTeam.name }
      : matched.teamName && matched.teamName !== "Unassigned"
        ? { id: null, name: matched.teamName }
        : null;

    const portalRole =
      (portal && isStaffPortalRole(portal.role) ? normalizePortalRole(portal.role) : null) ??
      (row.role === "admin" || row.role === "hr" ? "Admin" : "Personnel");

    out.push({
      mergedSourceUserId: sourceKey,
      agentId: agent.id,
      name: row.name,
      email,
      portalRole,
      headPrivileges: portal?.headPrivileges ?? false,
      assignmentCompany,
      teamLabel: assignmentCompany?.name ?? (matched.teamName || "Unassigned company/SBU"),
    });
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
