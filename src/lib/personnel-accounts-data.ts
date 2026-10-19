import { isElevatedUserRole } from "@/modules/platform/auth";
import { loadPortalStaffAssignmentColorMap } from "@/lib/portal-staff-assignment-color-sql";
import {
  resolveHrisSourceTags,
  resolveSecondaryDatabaseName,
} from "@/lib/merged-database-sources";
import { mapHrisToPortalRole } from "@/modules/platform/auth/role-mapping";
import type { UserRole } from "@/modules/platform/auth";
import { matchCompanyByLabel } from "@/modules/platform/companies/company-label";
import { ACTIVE_COMPANY_WHERE, COMPANY_ORDER_BY } from "@/modules/platform/companies/company-directory";
import { prismaPrimary, prismaSecondary } from "@/modules/platform/db/prisma";
import { normalizePersonName } from "@/lib/person-name";
import { normalizePortalRole } from "@/lib/staff-role";
import { Prisma } from "@prisma/client/primary";

export type PersonnelRosterRow = {
  /** HRIS / merged_users primary key */
  mergedSourceUserId: string;
  /** Linked ticketing agent when progress can be attributed (optional). */
  agentId: string | null;
  name: string;
  email: string;
  username: string | null;
  /** Default company (membership), else the HRIS company. */
  teamId: string;
  teamName: string;
  /** Every company the person belongs to (company filters match any of these). */
  companyIds: string[];
  companyNames: string[];
  /** Linked portal profile id when present (colors / auth projection). */
  portalAccountId: string | null;
  staffRole: string;
  accountStatus: string;
  staffAssignmentColor: string | null;
  /** Overall KPI % from merged_kpi_user_averages (synced from PG). */
  kpiOverallPercent: number | null;
  kpiAveragePercent: number | null;
};

export type PersonnelAccountsPayload = {
  teams: { id: string; name: string }[];
  personnel: PersonnelRosterRow[];
  scopedCompanyTeamId: string | null;
  scopedCompanyName: string | null;
  scopeUnavailable: boolean;
  viewerMode: "superadmin" | "admin";
  /** Display label for the roster source (the imported HRIS snapshot). */
  secondaryDatabaseName: string;
};

type MergedStaffRow = {
  source_user_id: bigint;
  name: string;
  username: string | null;
  email: string | null;
  role: string;
  company_name: string | null;
  position: string | null;
  department: string | null;
  is_active: number | boolean;
};

type KpiAvgRow = {
  source_user_id: bigint;
  overall_percent: number;
  average_percent: number;
};

function companyKey(name: string | null | undefined): string {
  return normalizePersonName(name ?? "");
}

/**
 * Map HRIS `company_name` onto a company (directory name/code/alias → exact/loose
 * name match). Synthetic ids (`company:…`) are used when no company row exists —
 * assignable APIs should treat those as unscoped for company filters.
 */
export function matchPersonnelCompanyTeam(
  companyName: string | null | undefined,
  teams: Array<{ id: string; name: string; code?: string | null; aliases?: readonly string[] }>,
): { teamId: string; teamName: string } {
  const directoryHit = matchCompanyByLabel(
    companyName,
    teams.map((t) => ({ ...t, code: t.code ?? null, aliases: t.aliases ?? [] })),
  );
  if (directoryHit) return { teamId: directoryHit.id, teamName: directoryHit.name };
  const display = companyName?.trim() || "Unassigned";
  const key = companyKey(display);
  if (!key || key === "unassigned") {
    return { teamId: "company:unassigned", teamName: "Unassigned" };
  }
  const exact = teams.find((t) => companyKey(t.name) === key);
  if (exact) return { teamId: exact.id, teamName: exact.name };
  // Prefer the longest loose match so "MCHISI FAMES" does not land on
  // "MCHISI LPG" (or vice versa) via a shared brand token like "mchisi".
  const loose = teams
    .map((t) => ({ team: t, tk: companyKey(t.name) }))
    .filter(({ tk }) => tk.includes(key) || key.includes(tk))
    .sort((a, b) => b.tk.length - a.tk.length)[0];
  if (loose) return { teamId: loose.team.id, teamName: loose.team.name };
  return { teamId: `company:${key.replace(/\s+/g, "-")}`, teamName: display };
}

/** @deprecated use matchPersonnelCompanyTeam */
function matchTeamId(
  companyName: string | null,
  teams: Array<{ id: string; name: string }>,
): { teamId: string; teamName: string } {
  return matchPersonnelCompanyTeam(companyName, teams);
}

function personTokens(name: string): Set<string> {
  return new Set(
    normalizePersonName(name)
      .replace(/[,.]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
}

function scoreNames(a: string, b: string): number {
  const at = personTokens(a);
  const bt = personTokens(b);
  return [...at].filter((t) => bt.has(t)).length;
}

/**
 * Personnel roster from the main-DB `hris_users` snapshot (HRIS users from the
 * merged-dump import). Portal/agent rows are not listed — only used to attach
 * assignment color / optional agent link. KPI averages still come from the
 * merged DB (efficiency data, not identity) and soft-fail when unavailable.
 */
export async function loadPersonnelAccountsPayload(viewer: {
  role: UserRole;
  /** Viewer's current company (switcher). Required scope for non-global viewers. */
  currentCompanyId: string | null;
}): Promise<PersonnelAccountsPayload> {
  const isSuperAdmin = isElevatedUserRole(viewer.role);
  const sourceTags = resolveHrisSourceTags();
  const secondaryDatabaseName = `the HRIS import (${resolveSecondaryDatabaseName()} dump)`;

  const [teams, agents, portals, mergedUsers, kpiAverages] = await Promise.all([
    prismaPrimary.company.findMany({
      where: ACTIVE_COMPANY_WHERE,
      orderBy: COMPANY_ORDER_BY,
      select: { id: true, name: true, code: true, aliases: true },
    }),
    prismaPrimary.agent.findMany({ select: { id: true, email: true, name: true } }),
    prismaPrimary.portalAccount.findMany({
      where: {
        mergedSourceUserId: { not: null },
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        mergedSourceUserId: true,
        accountStatus: true,
        staffDesignatedCompanyId: true,
        companyMemberships: { select: { companyId: true } },
      },
    }),
    prismaPrimary.$queryRaw<MergedStaffRow[]>`
      SELECT
        source_user_id, name, username, email, role, company_name, position, department, is_active
      FROM hris_users
      WHERE is_active = true
        AND source_database IN (${Prisma.join(sourceTags)})
        -- Platform super_admin rows are excluded here just like the on-duty
        -- Activity loader, so both Workforce views filter the same people.
        AND role <> 'super_admin'
      ORDER BY name ASC
    `,
    // Table is created by ensureMergedPortalWorkTables / portal-work sync.
    // Soft-fail so Personnel still loads when averages have not been bootstrapped yet.
    prismaSecondary
      .$queryRaw<KpiAvgRow[]>`
        SELECT source_user_id, overall_percent, average_percent
        FROM merged_kpi_user_averages
      `
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          "[personnel] KPI averages unavailable from the merged DB; KPI % columns will be empty.",
          message.split("\n")[0],
        );
        return [] as KpiAvgRow[];
      }),
  ]);

  const colorByPortalId = await loadPortalStaffAssignmentColorMap();
  /**
   * Prefer the active portal profile; fall back to a LEGACY_CONFLICT one so
   * users whose portals were all merged/conflicted (e.g. duplicate-email
   * legacy accounts) still expose their assignment color and profile link.
   */
  const portalByMergedId = new Map<string, (typeof portals)[number]>();
  for (const p of portals) {
    if (p.mergedSourceUserId == null) continue;
    const key = p.mergedSourceUserId.toString();
    const existing = portalByMergedId.get(key);
    if (!existing || (existing.accountStatus === "LEGACY_CONFLICT" && p.accountStatus !== "LEGACY_CONFLICT")) {
      portalByMergedId.set(key, p);
    }
  }
  const kpiByMergedId = new Map(
    kpiAverages.map((k) => [
      k.source_user_id.toString(),
      { overall: k.overall_percent, average: k.average_percent },
    ]),
  );

  const teamNameById = new Map(teams.map((t) => [t.id, t.name] as const));
  const personnel: PersonnelRosterRow[] = mergedUsers.map((m) => {
    const id = m.source_user_id.toString();
    const portal = portalByMergedId.get(id) ?? null;
    // Default membership (User Management) wins over the HRIS snapshot.
    const designatedTeam = portal?.staffDesignatedCompanyId
      ? teams.find((t) => t.id === portal.staffDesignatedCompanyId)
      : undefined;
    const company = designatedTeam
      ? { teamId: designatedTeam.id, teamName: designatedTeam.name }
      : matchTeamId(m.company_name, teams);
    const memberCompanyIds = (portal?.companyMemberships.map((mc) => mc.companyId) ?? []).filter((cid) =>
      teamNameById.has(cid),
    );
    const companyIds = memberCompanyIds.length > 0 ? memberCompanyIds : [company.teamId];
    const companyNames = companyIds.map((cid) => teamNameById.get(cid) ?? company.teamName);
    const mapped = mapHrisToPortalRole({
      hrisRole: m.role,
      position: m.position,
      department: m.department,
    });
    // Prefer SuperAdmin-managed portal role when a linked profile exists.
    const portalRole =
      (portal ? normalizePortalRole(portal.role) : null) ?? mapped.portalRole;

    // Optional: link a PG agent by email or name for ops/progress attribution.
    const emailNeedle = (m.email ?? portal?.email ?? "").trim().toLowerCase();
    let agent =
      emailNeedle.length > 0
        ? agents.find((a) => a.email.trim().toLowerCase() === emailNeedle) ?? null
        : null;
    if (!agent) {
      let best = 0;
      for (const a of agents) {
        const score = scoreNames(m.name, a.name);
        if (score >= 2 && score > best) {
          best = score;
          agent = a;
        }
      }
    }

    const kpi = kpiByMergedId.get(id) ?? null;
    return {
      mergedSourceUserId: id,
      agentId: agent?.id ?? null,
      name: m.name,
      email: (m.email ?? portal?.email ?? "").trim().toLowerCase() || `${m.username ?? id}@hris.merged`,
      username: m.username,
      teamId: company.teamId,
      teamName: company.teamName,
      companyIds,
      companyNames,
      portalAccountId: portal?.id ?? null,
      staffRole: portalRole,
      accountStatus:
        portal && portal.accountStatus !== "LEGACY_CONFLICT"
          ? portal.accountStatus
          : m.is_active
            ? "ACTIVE"
            : "INACTIVE",
      staffAssignmentColor: portal ? colorByPortalId.get(portal.id) ?? null : null,
      kpiOverallPercent: kpi?.overall ?? null,
      kpiAveragePercent: kpi?.average ?? null,
    };
  });

  // Company list for filters: prefer real teams, plus any HRIS-only companies.
  const companyNames = new Map<string, { id: string; name: string }>();
  for (const t of teams) companyNames.set(t.id, t);
  for (const row of personnel) {
    if (!companyNames.has(row.teamId)) {
      companyNames.set(row.teamId, { id: row.teamId, name: row.teamName });
    }
  }
  const companies = [...companyNames.values()].map((c) => ({ id: c.id, name: c.name }));

  if (isSuperAdmin) {
    return {
      teams: companies,
      personnel,
      scopedCompanyTeamId: null,
      scopedCompanyName: null,
      scopeUnavailable: false,
      viewerMode: "superadmin",
      secondaryDatabaseName,
    };
  }

  const scopeId = viewer.currentCompanyId;
  const companyTeam = scopeId ? teams.find((t) => t.id === scopeId) : undefined;
  if (!scopeId || !companyTeam) {
    return {
      teams: [],
      personnel: [],
      scopedCompanyTeamId: null,
      scopedCompanyName: null,
      scopeUnavailable: true,
      viewerMode: "admin",
      secondaryDatabaseName,
    };
  }

  const scopedName = companyTeam.name;

  return {
    teams: companies.filter((t) => t.id === scopeId),
    personnel: personnel.filter((row) => row.companyIds.includes(scopeId)),
    scopedCompanyTeamId: scopeId,
    scopedCompanyName: scopedName,
    scopeUnavailable: false,
    viewerMode: "admin",
    secondaryDatabaseName,
  };
}
