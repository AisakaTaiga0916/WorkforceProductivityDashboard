import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { orgChartLayerById, orgChartReportingParentByNodeId } from "@/app/admin/superadmin-settings/org-chart-layers";
import {
  resolveAgentIdsForPositionCode,
  resolveDirectManagerAgentId,
  resolveMergedSourceUserIdForSessionEmail,
} from "@/lib/approval-position-resolver";
import { loadHrisAssignableStaff } from "@/lib/hris-staff-roster";
import { loadOnDutyAgentIdSet } from "@/lib/load-on-duty-snapshot";
import { prisma } from "@/lib/prisma";
import { resolveOpsPermissions } from "@/lib/ops-permissions";
import { resolveAgentDesignatedCompanyId } from "@/lib/staff-company-scope";
import { rosterTeamNameFilter } from "@/lib/company-roster";
import {
  listOrgChartSectionHeads,
  resolveAgentIdsForOrgChartSection,
  resolveDepartmentDesignationsByMergedIds,
} from "@/lib/org-chart-section-roster";

export async function GET(req: Request) {
  const { session, unauthorized } = await requireRole(["Admin", "Personnel", "SuperAdmin", "HighAdmin"]);
  if (unauthorized || !session) return unauthorized;

  const perms = await resolveOpsPermissions(session);
  const searchParams = new URL(req.url).searchParams;
  const companyTeamId = searchParams.get("company")?.trim();
  const orgChartSectionId = searchParams.get("section")?.trim();
  const forMainAgentId = searchParams.get("forMainAgentId")?.trim();
  /** When `onDutyOnly=1`, omit Offline assignees (merged DB clock-in). */
  const onDutyOnly = searchParams.get("onDutyOnly") === "1" || searchParams.get("onDutyOnly") === "true";
  const positionCode = searchParams.get("positionCode")?.trim().toUpperCase().replace(/\s+/g, "_");
  const positionLevelRaw = searchParams.get("positionLevel")?.trim();
  const positionLevel = positionLevelRaw && /^\d+$/.test(positionLevelRaw) ? Number(positionLevelRaw) : null;
  const assignToManager =
    searchParams.get("assignToManager") === "1" || searchParams.get("assignToManager") === "true";
  const orgChartHeads =
    searchParams.get("orgChartHeads") === "1" || searchParams.get("orgChartHeads") === "true";
  /** Skip portal profile images (base64) — prevents OOM on large rosters; enough for pickers. */
  const lite =
    searchParams.get("lite") === "1" ||
    searchParams.get("lite") === "true" ||
    searchParams.get("omitProfile") === "1";
  const includeProfile =
    !lite &&
    (searchParams.get("includeProfile") === "1" ||
      searchParams.get("includeProfile") === "true");
  const includeOrgChartLayer =
    searchParams.get("includeOrgChartLayer") === "1" ||
    searchParams.get("includeOrgChartLayer") === "true";

  if (orgChartHeads) {
    const heads = await listOrgChartSectionHeads();
    return NextResponse.json(heads, {
      headers: { "cache-control": "private, max-age=5, stale-while-revalidate=10" },
    });
  }

  let companyIdFilter: string | null = null;
  const anyCompany =
    searchParams.get("anyCompany") === "1" || searchParams.get("anyCompany") === "true";
  if (anyCompany) {
    // Explicit cross-company listing (Travel Order approvers/confirmers/travelers, etc.).
    companyIdFilter = null;
  } else if (forMainAgentId) {
    const mainCompanyId = await resolveAgentDesignatedCompanyId(forMainAgentId);
    if (!mainCompanyId) return NextResponse.json([]);
    companyIdFilter = mainCompanyId;
  } else if (companyTeamId && companyTeamId !== "ALL") {
    // Honor explicit company for Admin and Personnel (RFP send-to Accounting/Finance, etc.).
    const team = await prisma.team.findFirst({
      where: { id: companyTeamId, ...rosterTeamNameFilter() },
      select: { id: true },
    });
    if (!team) return NextResponse.json([]);
    companyIdFilter = team.id;
  } else if (!perms.canAssignWork && perms.operator?.id) {
    // Personnel with no company param: colleagues in their own company only.
    companyIdFilter = await resolveAgentDesignatedCompanyId(perms.operator.id);
    if (!companyIdFilter) return NextResponse.json([]);
  }

  const [staff, orgNodes, orgSections] = await Promise.all([
    loadHrisAssignableStaff({
      // Company filter uses the same merged_users.company_name → Team mapping as Personnel.
      companyTeamId: companyIdFilter,
    }),
    includeOrgChartLayer
      ? prisma.orgChartNode.findMany({
          select: { id: true, parentId: true, mergedSourceUserId: true },
        })
      : Promise.resolve(
          [] as Array<{ id: string; parentId: string | null; mergedSourceUserId: string }>,
        ),
    includeOrgChartLayer
      ? prisma.orgChartSection.findMany({
          select: { headNodeId: true, reportsToNodeId: true },
        })
      : Promise.resolve(
          [] as Array<{ headNodeId: string | null; reportsToNodeId: string | null }>,
        ),
  ]);

  const reportingParentByNodeId = includeOrgChartLayer
    ? orgChartReportingParentByNodeId(orgNodes, orgSections)
    : new Map<string, string | null>();
  const layerByNodeId = includeOrgChartLayer
    ? orgChartLayerById(orgNodes, reportingParentByNodeId)
    : new Map<string, number>();
  const orgChartLayerByMergedId = new Map<string, number>();
  if (includeOrgChartLayer) {
    for (const node of orgNodes) {
      orgChartLayerByMergedId.set(node.mergedSourceUserId, layerByNodeId.get(node.id) ?? 1);
    }
  }

  const agentIds = staff.map((s) => s.agentId);
  const agents = agentIds.length
    ? await prisma.agent.findMany({
        where: { id: { in: agentIds } },
        select: {
          id: true,
          name: true,
          email: true,
          teamId: true,
          team: { select: { id: true, name: true } },
        },
      })
    : [];
  const agentById = new Map(agents.map((a) => [a.id, a]));
  const agentEmails = agents
    .map((a) => a.email?.trim().toLowerCase())
    .filter((email): email is string => Boolean(email));
  // Never select profileImage (often multi‑MB data URLs) unless explicitly requested —
  // loading every portal row with images OOMs Postgres/Node on large rosters.
  const portalProfiles =
    includeProfile && agentEmails.length
      ? await prisma.portalAccount.findMany({
          where: { email: { in: agentEmails } },
          select: {
            email: true,
            profileImageZoom: true,
            profileImagePosX: true,
            profileImagePosY: true,
          },
        })
      : [];
  const profileByEmail = new Map(portalProfiles.map((p) => [p.email.trim().toLowerCase(), p]));
  const onDutyIds = await loadOnDutyAgentIdSet(agentIds);
  let departmentByMergedId = new Map<string, string>();
  if (includeOrgChartLayer) {
    try {
      departmentByMergedId = await resolveDepartmentDesignationsByMergedIds(
        staff.map((s) => s.mergedSourceUserId),
      );
    } catch {
      departmentByMergedId = new Map();
    }
  }

  let payload = staff
    .map((s) => {
      const agent = agentById.get(s.agentId);
      if (!agent) return null;
      const isOnDuty = onDutyIds.has(s.agentId);
      const profile = profileByEmail.get(agent.email?.trim().toLowerCase() ?? "");
      // Prefer Personnel-tab company on the agent payload (not agent.team, which can drift).
      const assignmentCompany = s.assignmentCompany;
      const team =
        assignmentCompany?.id != null
          ? { id: assignmentCompany.id, name: assignmentCompany.name }
          : agent.team;
      return {
        id: agent.id,
        name: agent.name,
        email: agent.email,
        teamId: team?.id ?? agent.teamId,
        team,
        portalRole: s.portalRole,
        headPrivileges: s.headPrivileges,
        assignmentCompany,
        isOnDuty,
        dutyStatus: isOnDuty ? ("ON_DUTY" as const) : ("OFFLINE" as const),
        profileImage: null as string | null,
        profileImageZoom: profile?.profileImageZoom ?? 1,
        profileImagePosX: profile?.profileImagePosX ?? 50,
        profileImagePosY: profile?.profileImagePosY ?? 50,
        orgChartLayer: includeOrgChartLayer
          ? (orgChartLayerByMergedId.get(s.mergedSourceUserId) ?? null)
          : null,
        departmentDesignation: includeOrgChartLayer
          ? (departmentByMergedId.get(s.mergedSourceUserId) ?? null)
          : null,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);

  if (onDutyOnly) {
    payload = payload.filter((a) => a.isOnDuty);
  }

  if (orgChartSectionId) {
    const sectionAgentIds = new Set(await resolveAgentIdsForOrgChartSection(orgChartSectionId));
    payload = payload.filter((row) => sectionAgentIds.has(row.id));
  }

  if (positionCode) {
    const positionAgentIds = await resolveAgentIdsForPositionCode({
      code: positionCode,
      companyTeamId: companyIdFilter,
    });
    const allowed = new Set(positionAgentIds);
    payload = payload.filter((row) => allowed.has(row.id));
  } else if (positionLevel != null) {
    const positionsAtLevel = await prisma.position.findMany({
      where: { level: positionLevel, isActive: true },
      select: { id: true },
    });
    if (positionsAtLevel.length === 0) {
      payload = [];
    } else {
      const assignments = await prisma.positionAssignment.findMany({
        where: { positionId: { in: positionsAtLevel.map((row) => row.id) } },
        select: { mergedSourceUserId: true, companyTeamId: true },
      });
      const mergedIds = new Set(
        assignments
          .filter((row) => !companyIdFilter || row.companyTeamId == null || row.companyTeamId === companyIdFilter)
          .map((row) => row.mergedSourceUserId),
      );
      payload = payload.filter((row) => {
        const staffRow = staff.find((s) => s.agentId === row.id);
        return staffRow ? mergedIds.has(staffRow.mergedSourceUserId) : false;
      });
    }
  }

  if (assignToManager) {
    const mergedId = await resolveMergedSourceUserIdForSessionEmail(session.user.email);
    if (!mergedId) {
      payload = [];
    } else {
      const managerAgentId = await resolveDirectManagerAgentId({
        mergedSourceUserId: mergedId,
        companyTeamId: companyIdFilter,
      });
      payload = managerAgentId ? payload.filter((row) => row.id === managerAgentId) : [];
    }
  }

  return NextResponse.json(payload, {
    headers: { "cache-control": "private, max-age=5, stale-while-revalidate=10" },
  });
}
