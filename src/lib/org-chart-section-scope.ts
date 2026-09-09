/**
 * Promote org-chart section heads to portal Admin, and resolve section-scoped
 * visibility for request / task boards. Custom org-chart section roles
 * (Deputy, Coordinator, …) remain membership labels — they do not change
 * portal role. **Personnel vs Admin** for staff follows the org chart:
 * department / sub-department heads → Admin; other staff → Personnel.
 */
import { Prisma } from "@prisma/client/primary";
import { prisma } from "@/lib/prisma";
import { resolveMergedSourceUserIdForSessionEmail } from "@/lib/approval-position-resolver";
import { personnelRequestBoardWhere } from "@/lib/rfp-request-board";
import {
  resolveOrgChartSectionIdsForMergedUser,
  resolveAgentIdsForOrgChartSection,
} from "@/lib/org-chart-section-roster";
import { isElevatedUserRole } from "@/lib/auth";
import { hasSubKpiAssignedTo } from "@/lib/kpi-subkpis";
import { normalizePortalRole } from "@/lib/staff-role";

/** Pure helper: membership / filter roots → self + nested sub-departments. */
export function collectOrgChartDescendantIds(
  rootIds: string[],
  sections: Array<{ id: string; parentId: string | null }>,
): string[] {
  const roots = [...new Set(rootIds.map((id) => id.trim()).filter(Boolean))];
  if (roots.length === 0) return [];

  const childrenByParent = new Map<string | null, string[]>();
  for (const s of sections) {
    const list = childrenByParent.get(s.parentId) ?? [];
    list.push(s.id);
    childrenByParent.set(s.parentId, list);
  }

  const out = new Set<string>();
  for (const root of roots) {
    const stack = [root];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (out.has(id)) continue;
      out.add(id);
      stack.push(...(childrenByParent.get(id) ?? []));
    }
  }
  return [...out];
}

/** Membership sections plus all nested sub-departments. */
export async function expandOrgChartSectionIdsWithDescendants(
  sectionIds: string[],
): Promise<string[]> {
  const roots = [...new Set(sectionIds.map((id) => id.trim()).filter(Boolean))];
  if (roots.length === 0) return [];
  const sections = await prisma.orgChartSection.findMany({
    select: { id: true, parentId: true },
  });
  return collectOrgChartDescendantIds(roots, sections);
}

/**
 * Request-board Departments filter: selected department + nested sub-departments.
 * Intersects with `allowedSectionIds` when the viewer is section-scoped.
 */
export async function ticketWhereForOrgChartSectionFilter(opts: {
  sectionId: string;
  /** When set, only keep ids the viewer is allowed to see. */
  allowedSectionIds?: readonly string[] | null;
}): Promise<Prisma.TicketWhereInput> {
  const sectionId = opts.sectionId.trim();
  if (!sectionId || sectionId === "ALL") return {};

  let ids = await expandOrgChartSectionIdsWithDescendants([sectionId]);
  if (opts.allowedSectionIds) {
    const allowed = new Set(opts.allowedSectionIds);
    ids = ids.filter((id) => allowed.has(id));
  }
  if (ids.length === 0) {
    return { id: "__none__" };
  }
  return { orgChartSectionId: { in: ids } };
}

/** Merged HRIS ids currently set as a department or sub-department head. */
export async function resolveOrgChartHeadMergedSourceUserIds(): Promise<Set<string>> {
  const headSections = await prisma.orgChartSection.findMany({
    where: { headNodeId: { not: null } },
    select: { headNodeId: true },
  });
  const headNodeIds = [
    ...new Set(
      headSections
        .map((h) => h.headNodeId)
        .filter((id): id is string => Boolean(id?.trim())),
    ),
  ];
  if (headNodeIds.length === 0) return new Set();

  const nodes = await prisma.orgChartNode.findMany({
    where: { id: { in: headNodeIds } },
    select: { mergedSourceUserId: true },
  });
  return new Set(
    nodes
      .map((n) => n.mergedSourceUserId?.trim())
      .filter((id): id is string => Boolean(id)),
  );
}

/** Org-chart stores merged ids as strings; portal_accounts uses BigInt. */
function mergedSourceUserIdAsBigInt(raw: string | null | undefined): bigint | null {
  const s = String(raw ?? "").trim();
  if (!/^\d+$/.test(s)) return null;
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}

function warnOrgChartPortalLookup(mergedId: string, reason: string): void {
  console.warn(`[org-chart] portal lookup skipped for mergedSourceUserId=${mergedId}: ${reason}`);
}

async function findStaffPortalByMergedSourceUserId(mergedId: string): Promise<{
  id: string;
  role: string;
  headPrivileges: boolean;
} | null> {
  const asBigInt = mergedSourceUserIdAsBigInt(mergedId);
  if (asBigInt == null) {
    warnOrgChartPortalLookup(mergedId, "non-numeric or empty id");
    return null;
  }
  const portal = await prisma.portalAccount.findFirst({
    where: { mergedSourceUserId: asBigInt },
    select: { id: true, role: true, headPrivileges: true },
  });
  if (!portal) {
    warnOrgChartPortalLookup(mergedId, "no matching portal_accounts row");
  }
  return portal;
}

export async function isMergedUserOrgChartSectionHead(
  mergedSourceUserId: string | null | undefined,
): Promise<boolean> {
  const mergedId = String(mergedSourceUserId ?? "").trim();
  if (!mergedId) return false;
  const heads = await resolveOrgChartHeadMergedSourceUserIds();
  return heads.has(mergedId);
}

/**
 * Portal technical role (Admin / Personnel / …) keyed by org-chart mergedSourceUserId string.
 * Used on department cards so heads show Admin/Personnel, not the HRIS personRole snapshot.
 */
export async function resolvePortalTechnicalRolesByMergedSourceUserIds(
  mergedSourceUserIds: Iterable<string>,
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(
      [...mergedSourceUserIds].map((id) => String(id ?? "").trim()).filter(Boolean),
    ),
  ];
  const bigints = ids
    .map((id) => mergedSourceUserIdAsBigInt(id))
    .filter((id): id is bigint => id != null);
  if (bigints.length === 0) return new Map();

  const portals = await prisma.portalAccount.findMany({
    where: { mergedSourceUserId: { in: bigints } },
    select: { mergedSourceUserId: true, role: true },
  });

  const out = new Map<string, string>();
  for (const portal of portals) {
    if (portal.mergedSourceUserId == null) continue;
    const key = String(portal.mergedSourceUserId);
    const role = normalizePortalRole(portal.role) ?? portal.role;
    out.set(key, role);
  }
  return out;
}

/**
 * Promote a single section-head node to Admin. Prefer
 * `reconcilePortalStaffRolesFromOrgChart` after head changes so former heads
 * are demoted. Never touches SuperAdmin / HighAdmin / Customer / Personnel-Guard.
 */
export async function ensurePortalAdminForOrgChartHeadNode(
  headNodeId: string | null | undefined,
): Promise<void> {
  const id = (headNodeId ?? "").trim();
  if (!id) return;

  const isSectionHead = await prisma.orgChartSection.findFirst({
    where: { headNodeId: id },
    select: { id: true },
  });
  if (!isSectionHead) return;

  const node = await prisma.orgChartNode.findUnique({
    where: { id },
    select: { mergedSourceUserId: true },
  });
  const mergedId = (node?.mergedSourceUserId ?? "").trim();
  if (!mergedId) return;

  const portal = await findStaffPortalByMergedSourceUserId(mergedId);
  if (!portal) return;
  const role = normalizePortalRole(portal.role) ?? portal.role;
  if (role === "SuperAdmin" || role === "HighAdmin") return;
  if (role === "Customer" || role === "Personnel-Guard") return;
  if (role === "Admin" && portal.headPrivileges === true) return;

  await prisma.portalAccount.update({
    where: { id: portal.id },
    data: { role: "Admin", headPrivileges: true },
  });
}

export type OrgChartStaffRoleReconcileResult = {
  /** Department + sub-department head count (unique people). */
  headCount: number;
  promoted: number;
  demoted: number;
  /** Heads skipped because merged id was non-numeric or portal row missing. */
  skippedHeads: number;
};

/**
 * Align Personnel / Admin technical roles with the org chart:
 * - Heads of departments and sub-departments → Admin (+ headPrivileges)
 * - Former chart heads (Admin + headPrivileges, no longer a head) → Personnel
 * - Company Admins without headPrivileges are left alone
 * - SuperAdmin / HighAdmin / Customer / Personnel-Guard unchanged
 * - Admin accounts with no merged HRIS id are left alone
 */
export async function reconcilePortalStaffRolesFromOrgChart(): Promise<OrgChartStaffRoleReconcileResult> {
  const headMergedIds = await resolveOrgChartHeadMergedSourceUserIds();

  let promoted = 0;
  let skippedHeads = 0;
  for (const mergedId of headMergedIds) {
    const portal = await findStaffPortalByMergedSourceUserId(mergedId);
    if (!portal) {
      skippedHeads += 1;
      continue;
    }
    const role = normalizePortalRole(portal.role) ?? portal.role;
    if (role === "SuperAdmin" || role === "HighAdmin") continue;
    if (role === "Customer" || role === "Personnel-Guard") continue;
    if (role === "Admin" && portal.headPrivileges === true) continue;

    await prisma.portalAccount.update({
      where: { id: portal.id },
      data: { role: "Admin", headPrivileges: true },
    });
    promoted += 1;
  }

  // Only demote Admins that were promoted via org-chart headship (headPrivileges).
  const admins = await prisma.portalAccount.findMany({
    where: {
      role: "Admin",
      headPrivileges: true,
      mergedSourceUserId: { not: null },
    },
    select: { id: true, mergedSourceUserId: true },
  });

  let demoted = 0;
  for (const portal of admins) {
    const mergedId =
      portal.mergedSourceUserId != null ? String(portal.mergedSourceUserId) : "";
    if (!mergedId || headMergedIds.has(mergedId)) continue;

    await prisma.portalAccount.update({
      where: { id: portal.id },
      data: { role: "Personnel", headPrivileges: false },
    });
    demoted += 1;
  }

  if (skippedHeads > 0) {
    console.warn(
      `[org-chart] reconcile skipped ${skippedHeads} head(s) with missing/invalid portal link`,
    );
  }

  return {
    headCount: headMergedIds.size,
    promoted,
    demoted,
    skippedHeads,
  };
}

/** Backfill / alias: full chart-based Personnel ↔ Admin reconcile. */
export async function ensurePortalAdminForAllOrgChartSectionHeads(): Promise<number> {
  const result = await reconcilePortalStaffRolesFromOrgChart();
  return result.headCount;
}

export type ViewerSectionScope = {
  /** Direct memberships + descendants. Empty if the user has no org-chart section. */
  sectionIds: string[];
  /** Agent ids of people in those sections (for task-board filtering). */
  agentIds: string[];
};

export async function resolveViewerOrgChartSectionScope(
  email: string | null | undefined,
): Promise<ViewerSectionScope> {
  const mergedId = await resolveMergedSourceUserIdForSessionEmail(email);
  const membershipIds = await resolveOrgChartSectionIdsForMergedUser(mergedId);
  const sectionIds = await expandOrgChartSectionIdsWithDescendants(membershipIds);
  if (sectionIds.length === 0) {
    return { sectionIds: [], agentIds: [] };
  }
  const agentIdSets = await Promise.all(
    sectionIds.map((id) => resolveAgentIdsForOrgChartSection(id)),
  );
  const agentIds = [...new Set(agentIdSets.flat())];
  return { sectionIds, agentIds };
}

/**
 * True when the viewer is the org-chart head of `sectionId`, or heads an ancestor
 * department that contains it (major dept head covers nested send-to sections).
 */
export async function isViewerOrgChartHeadForSection(
  email: string | null | undefined,
  sectionId: string | null | undefined,
): Promise<boolean> {
  const sid = (sectionId ?? "").trim();
  const e = (email ?? "").trim();
  if (!sid || !e) return false;
  const mergedId = await resolveMergedSourceUserIdForSessionEmail(e);
  if (!mergedId) return false;
  const headed = await prisma.orgChartSection.findMany({
    where: { headNode: { mergedSourceUserId: mergedId } },
    select: { id: true },
  });
  if (headed.length === 0) return false;
  const headedIds = new Set(headed.map((h) => h.id));
  if (headedIds.has(sid)) return true;

  const sections = await prisma.orgChartSection.findMany({
    select: { id: true, parentId: true },
  });
  const byId = new Map(sections.map((s) => [s.id, s]));
  let current: string | null = sid;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    if (headedIds.has(current)) return true;
    current = byId.get(current)?.parentId ?? null;
  }
  return false;
}

/**
 * Ticket visibility for Personnel: send-to section in the viewer's section tree,
 * OR personal assignee / procedural / transfer scope.
 * Admin Request Board uses {@link personnelRequestBoardWhere} (assigned only).
 * SuperAdmin / HighAdmin use unrestricted board scope (all departments).
 */
export async function sectionScopedTicketWhere(input: {
  email: string | null | undefined;
  agentId: string | null | undefined;
}): Promise<Prisma.TicketWhereInput> {
  const scope = await resolveViewerOrgChartSectionScope(input.email);
  const personal =
    input.agentId != null ? await personnelRequestBoardWhere(input.agentId) : null;

  if (scope.sectionIds.length === 0) {
    return personal ?? { id: "__none__" };
  }

  const sectionScope: Prisma.TicketWhereInput = {
    orgChartSectionId: { in: scope.sectionIds },
  };
  if (personal) {
    return { OR: [sectionScope, personal] };
  }
  return sectionScope;
}

/** True when the ticket's send-to department is in the viewer's org-chart section tree. */
export async function ticketInViewerSectionScope(input: {
  email: string | null | undefined;
  orgChartSectionId: string | null | undefined;
}): Promise<boolean> {
  const sectionId = (input.orgChartSectionId ?? "").trim();
  if (!sectionId) return false;
  const scope = await resolveViewerOrgChartSectionScope(input.email);
  return scope.sectionIds.includes(sectionId);
}

/** Human-readable department scope label for dashboards (falls back to company). */
export async function resolveViewerDepartmentScopeLabel(
  email: string | null | undefined,
): Promise<string | null> {
  const scope = await resolveViewerOrgChartSectionScope(email);
  if (scope.sectionIds.length === 0) return null;
  const sections = await prisma.orgChartSection.findMany({
    where: { id: { in: scope.sectionIds } },
    select: { id: true, name: true, parentId: true },
  });
  const idSet = new Set(scope.sectionIds);
  const roots = sections.filter((s) => !s.parentId || !idSet.has(s.parentId));
  const names = (roots.length > 0 ? roots : sections)
    .map((s) => s.name.trim())
    .filter(Boolean)
    .slice(0, 3);
  if (names.length === 0) return null;
  if (roots.length > 3 || sections.length > roots.length) {
    return `${names.join(", ")} (+sub-departments)`;
  }
  return names.join(", ");
}

/** Whether this session role should be limited to org-chart section scope (Personnel Request Board). */
export function roleUsesOrgChartSectionBoardScope(role: string | null | undefined): boolean {
  if (!role) return false;
  if (isElevatedUserRole(role)) return false;
  return role === "Personnel";
}

/**
 * Task Board assign + KPI visibility: Admin and Personnel are locked to
 * designated company ∩ org-chart department tree. Elevated roles are free.
 * Distinct from {@link roleUsesOrgChartSectionBoardScope} (Request Board).
 */
export function roleUsesCompanyDepartmentTaskAssignScope(
  role: string | null | undefined,
): boolean {
  if (!role) return false;
  if (isElevatedUserRole(role)) return false;
  return role === "Admin" || role === "Personnel";
}

/** Sidebar / home: show designated department for Admin and Personnel. */
export function roleShowsDesignatedDepartmentLabel(
  role: string | null | undefined,
): boolean {
  if (!role) return false;
  if (isElevatedUserRole(role)) return false;
  return role === "Admin" || role === "Personnel";
}

/**
 * Task-board filter: main/sub assignee in the section agent set.
 * Unassigned tasks are hidden under section scope (no section FK on KPIs yet).
 */
export function kpiRowInSectionAgentScope(
  row: {
    assignedAgentId: string | null;
    subKpis: unknown;
  },
  sectionAgentIds: Set<string>,
): boolean {
  if (sectionAgentIds.size === 0) return false;
  if (row.assignedAgentId && sectionAgentIds.has(row.assignedAgentId)) return true;
  for (const agentId of sectionAgentIds) {
    if (hasSubKpiAssignedTo(row.subKpis, agentId)) return true;
  }
  return false;
}
