/**
 * Activities / On Duty roster: active personnel from the secondary merge DB
 * (merged_users is the source of truth for who exists, their name and company),
 * enriched with today's clock-in status from the merged attendance table.
 */

import { pickCanonicalAgentForPortal } from "@/lib/admin-roster";
import { mapHrisToPortalRole } from "@/modules/platform/auth/role-mapping";
import { resolveRosterCompanyName } from "@/modules/hierarchy/hris-company-aliases";
import {
  dutyStatusFromLatestClockIn,
  formatClockInLocalTime,
  isOnDutyStatus,
  loadTodayClockInsBySourceUserId,
  type DutyStatus,
} from "@/lib/merged-duty-status";
import { DEFAULT_TIME_ZONE } from "@/modules/tasks/kpi-recurrence";
import { resolveHrisSourceTags } from "@/lib/merged-database-sources";
import { prisma, prismaSecondary } from "@/modules/platform/db/prisma";
import { isStaffPortalRole, normalizePortalRole } from "@/lib/staff-role";
import {
  buildCanonicalMergedIdMap,
  canonicalMergedId,
  type MergedIdentityRow,
} from "@/lib/sync/merged-person-identity";

type MergedIdentitySqlRow = {
  source_user_id: bigint;
  name: string;
  email: string | null;
};

/** Load active merged identities + map synthetic portal ids → HRIS clock-in ids. */
async function loadCanonicalMergedIdMap(): Promise<Map<string, bigint>> {
  const rows = await prismaSecondary.$queryRaw<MergedIdentitySqlRow[]>`
    SELECT source_user_id, name, email
    FROM merged_users
    WHERE is_active = 1
  `;
  const identity: MergedIdentityRow[] = rows.map((r) => ({
    sourceUserId: r.source_user_id,
    name: r.name,
    email: r.email,
  }));
  return buildCanonicalMergedIdMap(identity);
}

function hasClockInForSourceId(
  clockIns: ReadonlyMap<string, Date>,
  sourceUserId: bigint,
  canonicalMap: ReadonlyMap<string, bigint>,
): boolean {
  const raw = sourceUserId.toString();
  if (clockIns.has(raw)) return true;
  const canonical = canonicalMergedId(sourceUserId, canonicalMap).toString();
  return clockIns.has(canonical);
}

export type OnDutyAgentSnapshot = {
  id: string;
  name: string;
  /** Merged HRIS email when available (used for search). */
  email?: string;
  /** Merged HRIS username when available (used for search, like the registry). */
  username?: string | null;
  /** Normalized portal role (SuperAdmin/HighAdmin/Admin/Personnel/…) when the
   *  person has a linked portal account; falls back to the merged HRIS role. */
  role?: string;
  companyName: string;
  /** @deprecated Prefer `dutyStatus` / `isOnDuty` — kept for older clients. */
  isOnline: boolean;
  dutyStatus: DutyStatus;
  isOnDuty: boolean;
  /** Latest clock-in today from merged DB (ISO), or null. */
  lastClockInAt: string | null;
  lastActivity: string;
  /** Avatar from the linked portal account profile (data URL or null). */
  profileImage?: string | null;
  profileImageZoom?: number | null;
  profileImagePosX?: number | null;
  profileImagePosY?: number | null;
};

export type OnDutySnapshot = {
  agents: OnDutyAgentSnapshot[];
  page: number;
  totalPages: number;
  total: number;
  companies: string[];
  /** Count currently On Duty from merged clock-ins (full filtered set). */
  onDutyCount: number;
};

type LoadOnDutyOptions = {
  page?: number;
  pageSize?: number;
  companyFilter?: string;
  /** Case-insensitive name or email substring. */
  searchQuery?: string;
  /** Normalized portal role (e.g. "Admin", "Personnel") to restrict to. */
  roleFilter?: string;
  /** When true, only return personnel who are On Duty today. */
  onDutyOnly?: boolean;
};

function formatLastActivity(clockInAt: Date | null, dutyStatus: DutyStatus): string {
  if (!clockInAt || dutyStatus === "OFFLINE") return "No clock-in today";
  // HRIS stores UTC; show Asia/Taipei (GMT+8) local time.
  return `Clocked in ${formatClockInLocalTime(clockInAt, DEFAULT_TIME_ZONE)}`;
}

/** Company label straight from merged_users.company_name (personnel source of truth). */
function companyLabel(mergedCompanyName: string | null | undefined): string {
  const merged = mergedCompanyName?.trim();
  if (merged) return resolveRosterCompanyName(merged) ?? merged;
  return "Unassigned";
}

type PortalProfileRow = {
  email: string;
  name: string;
  role: string;
  accountStatus: string;
  profileImage: string | null;
  profileImageZoom: number;
  profileImagePosX: number;
  profileImagePosY: number;
};

type MergedRosterRow = {
  source_user_id: bigint;
  name: string;
  username: string | null;
  email: string | null;
  role: string;
  company_name: string | null;
  position: string | null;
  department: string | null;
  source_database: string;
};

/**
 * Load the active merge-DB HRIS roster with today's clock-in status (PHT).
 * Primary portals/agents are used only to attach a stable agent id per person.
 */
export async function loadOnDutySnapshot(options: LoadOnDutyOptions = {}): Promise<OnDutySnapshot> {
  const pageSize = Math.min(48, Math.max(1, options.pageSize ?? 6));
  const pageRaw = Math.max(1, options.page ?? 1);
  const companyFilter = resolveRosterCompanyName(options.companyFilter) ?? options.companyFilter?.trim() ?? "";
  const searchQuery = options.searchQuery?.trim().toLowerCase() ?? "";
  const roleFilter = normalizePortalRole(options.roleFilter) ?? "";
  const sourceTags = new Set(resolveHrisSourceTags());

  const [mergedRows, portals, agents] = await Promise.all([
    prismaSecondary.$queryRaw<MergedRosterRow[]>`
      SELECT source_user_id, name, username, email, role, company_name, position, department, source_database
      FROM merged_users
      WHERE is_active = 1
      ORDER BY name ASC
    `,
    prisma.portalAccount.findMany({
      where: { mergedSourceUserId: { not: null } },
      select: {
        email: true,
        name: true,
        role: true,
        mergedSourceUserId: true,
        accountStatus: true,
        profileImage: true,
        profileImageZoom: true,
        profileImagePosX: true,
        profileImagePosY: true,
      },
    }),
    prisma.agent.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, email: true, name: true, createdAt: true },
    }),
  ]);

  /** Roster = HRIS rows only; other merged rows (portal duplicates) map back via canonical ids. */
  const rosterRows = mergedRows.filter(
    (r) => sourceTags.has(r.source_database) && r.role !== "super_admin",
  );
  if (rosterRows.length === 0) {
    return { agents: [], page: 1, totalPages: 1, total: 0, companies: [], onDutyCount: 0 };
  }

  const canonicalMap = buildCanonicalMergedIdMap(
    mergedRows.map((r) => ({ sourceUserId: r.source_user_id, name: r.name, email: r.email })),
  );
  const portalsByCanonicalId = new Map<string, PortalProfileRow[]>();
  const profileByEmail = new Map<string, PortalProfileRow>();
  for (const p of portals) {
    if (p.mergedSourceUserId == null) continue;
    const profile: PortalProfileRow = {
      email: p.email,
      name: p.name,
      role: p.role,
      accountStatus: p.accountStatus,
      profileImage: p.profileImage,
      profileImageZoom: p.profileImageZoom,
      profileImagePosX: p.profileImagePosX,
      profileImagePosY: p.profileImagePosY,
    };
    // Roster-consistent lookup: prefer the ACTIVE portal profile over a
    // LEGACY_CONFLICT duplicate sharing the same email, so the avatar used
    // here agrees with the role/avatar the Personnel ListView resolves.
    const emailKey = p.email.trim().toLowerCase();
    if (emailKey) {
      const existing = profileByEmail.get(emailKey);
      if (
        !existing ||
        (existing.accountStatus === "LEGACY_CONFLICT" && p.accountStatus !== "LEGACY_CONFLICT")
      ) {
        profileByEmail.set(emailKey, profile);
      }
    }
    const key = canonicalMergedId(p.mergedSourceUserId, canonicalMap).toString();
    const list = portalsByCanonicalId.get(key) ?? [];
    list.push(profile);
    portalsByCanonicalId.set(key, list);
  }
  // Role derivation must match the Personnel ListView, which prefers the
  // ACTIVE portal account over LEGACY_CONFLICT duplicates of the same person
  // (canonicalized synthetic rows). Without this, a person whose legacy
  // account has a different role (e.g. Personnel) would show one role here
  // and another on the ListView, so role filters return different people.
  for (const list of portalsByCanonicalId.values()) {
    list.sort(
      (a, b) =>
        (a.accountStatus === "LEGACY_CONFLICT" ? 1 : 0) -
        (b.accountStatus === "LEGACY_CONFLICT" ? 1 : 0),
    );
  }

  const clockInsToday = await loadTodayClockInsBySourceUserId(
    rosterRows.map((r) => r.source_user_id),
  );

  const allAgents: OnDutyAgentSnapshot[] = [];
  const seenIds = new Set<string>();

  for (const row of rosterRows) {
    const sourceKey = row.source_user_id.toString();

    /** Attach a primary agent id when one exists (by merged email, portal emails, or name). */
    const candidates = [
      ...(row.email?.trim() ? [{ email: row.email.trim().toLowerCase(), name: row.name }] : []),
      ...(portalsByCanonicalId.get(sourceKey) ?? []),
    ];
    let canon: { id: string } | null = null;
    for (const candidate of candidates) {
      canon = pickCanonicalAgentForPortal(candidate, agents);
      if (canon) break;
    }
    if (!canon) {
      canon = pickCanonicalAgentForPortal({ email: `${sourceKey}@hris.merged`, name: row.name }, agents);
    }

    const id = canon?.id ?? `merged:${sourceKey}`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const lastClockIn = clockInsToday.get(sourceKey) ?? null;
    const dutyStatus = dutyStatusFromLatestClockIn(lastClockIn);
    const isOnDuty = isOnDutyStatus(dutyStatus);

    /** Attach the avatar: prefer the primary agent's email → portal profile, then the HRIS-linked portal profile. */
    const agentRow = canon ? agents.find((a) => a.id === canon.id) : null;
    const portalProfile =
      (agentRow?.email ? profileByEmail.get(agentRow.email.trim().toLowerCase()) : null) ??
      portalsByCanonicalId.get(sourceKey)?.[0] ??
      null;

    /** Role: prefer the linked portal account role (matches the Workforce Role
     *  chips); fall back to the same HRIS→portal mapping the personnel roster
     *  uses (position/department-aware) so both views derive identical roles. */
    const portalRole = portalsByCanonicalId.get(sourceKey)?.[0]?.role;
    const mappedRole = mapHrisToPortalRole({
      hrisRole: row.role,
      position: row.position,
      department: row.department,
    });
    const role =
      (portalRole ? normalizePortalRole(portalRole) : null) ??
      mappedRole.portalRole ??
      normalizePortalRole(row.role) ??
      row.role ??
      "";

    allAgents.push({
      id,
      name: row.name,
      email: (row.email ?? "").trim().toLowerCase(),
      username: row.username,
      role,
      companyName: companyLabel(row.company_name),
      isOnline: isOnDuty,
      dutyStatus,
      isOnDuty,
      lastClockInAt: lastClockIn?.toISOString() ?? null,
      lastActivity: formatLastActivity(lastClockIn, dutyStatus),
      profileImage: portalProfile?.profileImage ?? null,
      profileImageZoom: portalProfile?.profileImageZoom ?? 1,
      profileImagePosX: portalProfile?.profileImagePosX ?? 50,
      profileImagePosY: portalProfile?.profileImagePosY ?? 50,
    });
  }

  allAgents.sort((a, b) => {
    if (a.isOnDuty !== b.isOnDuty) return a.isOnDuty ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const companies = [...new Set(allAgents.map((agent) => agent.companyName))].sort((a, b) =>
    a.localeCompare(b),
  );

  let filtered = companyFilter
    ? allAgents.filter((agent) => agent.companyName === companyFilter)
    : allAgents;

  if (searchQuery) {
    filtered = filtered.filter(
      (agent) =>
        agent.name.toLowerCase().includes(searchQuery) ||
        (agent.email ?? "").toLowerCase().includes(searchQuery) ||
        (agent.username ?? "").toLowerCase().includes(searchQuery),
    );
  }

  if (roleFilter) {
    filtered = filtered.filter((agent) => normalizePortalRole(agent.role) === roleFilter);
  }

  if (options.onDutyOnly) {
    filtered = filtered.filter((agent) => agent.isOnDuty);
  }

  const onDutyCount = filtered.filter((a) => a.isOnDuty).length;
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(totalPages, pageRaw);
  const start = (page - 1) * pageSize;
  const pageAgents = filtered.slice(start, start + pageSize);

  return { agents: pageAgents, page, totalPages, total, companies, onDutyCount };
}

/**
 * Set of primary Agent IDs that are On Duty today (merged clock-in).
 * Used by `/api/agents` and assignment APIs.
 */
export async function loadOnDutyAgentIdSet(
  agentIds?: ReadonlyArray<string>,
): Promise<Set<string>> {
  const portals = await prisma.portalAccount.findMany({
    where: {
      mergedSourceUserId: { not: null },
      accountStatus: "ACTIVE",
      ...(agentIds && agentIds.length > 0
        ? undefined
        : { role: { in: ["Admin", "Personnel"] } }),
    },
    select: {
      email: true,
      name: true,
      role: true,
      mergedSourceUserId: true,
    },
  });

  const staff = portals.filter((p) => isStaffPortalRole(p.role) && p.mergedSourceUserId != null);
  if (staff.length === 0) return new Set();

  const [agents, canonicalMap] = await Promise.all([
    prisma.agent.findMany({
      where:
        agentIds && agentIds.length > 0
          ? { id: { in: [...agentIds] } }
          : {
              email: {
                in: staff.map((p) => p.email.trim().toLowerCase()).filter(Boolean),
              },
            },
      select: { id: true, email: true, name: true, createdAt: true },
    }),
    loadCanonicalMergedIdMap(),
  ]);

  const lookupIds = new Set<bigint>();
  for (const portal of staff) {
    const raw = portal.mergedSourceUserId!;
    lookupIds.add(raw);
    lookupIds.add(canonicalMergedId(raw, canonicalMap));
  }

  const clockIns = await loadTodayClockInsBySourceUserId([...lookupIds]);
  const onDuty = new Set<string>();

  for (const portal of staff) {
    if (!hasClockInForSourceId(clockIns, portal.mergedSourceUserId!, canonicalMap)) continue;
    const canon = pickCanonicalAgentForPortal(portal, agents);
    if (canon) onDuty.add(canon.id);
  }
  return onDuty;
}

/** True when the agent is linked to HRIS and has a clock-in today in the merged DB. */
export async function isAgentOnDutyFromMergedDb(agentId: string): Promise<boolean> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { email: true, name: true, createdAt: true, id: true },
  });
  if (!agent) return false;

  const portals = await prisma.portalAccount.findMany({
    where: {
      mergedSourceUserId: { not: null },
      accountStatus: "ACTIVE",
      role: { in: ["Admin", "Personnel"] },
    },
    select: { email: true, name: true, role: true, mergedSourceUserId: true },
  });

  const match = portals.find((p) => {
    if (!isStaffPortalRole(p.role) || p.mergedSourceUserId == null) return false;
    return pickCanonicalAgentForPortal(p, [agent])?.id === agent.id;
  });
  if (!match?.mergedSourceUserId) return false;

  const canonicalMap = await loadCanonicalMergedIdMap();
  const raw = match.mergedSourceUserId;
  const canonical = canonicalMergedId(raw, canonicalMap);
  const clockIns = await loadTodayClockInsBySourceUserId([raw, canonical]);
  return hasClockInForSourceId(clockIns, raw, canonicalMap);
}
