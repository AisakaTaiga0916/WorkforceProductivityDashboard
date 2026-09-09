import { Prisma, type TicketStatus } from "@prisma/client/primary";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/access";
import { loadHrisAssignableStaff } from "@/lib/hris-staff-roster";
import { filterOrgChartSectionsByCompanyTeam } from "@/lib/org-chart-section-display";
import { listOrgChartSectionOptions } from "@/lib/org-chart-section-roster";
import {
  resolveViewerOrgChartSectionScope,
  roleUsesCompanyDepartmentTaskAssignScope,
} from "@/lib/org-chart-section-scope";
import { prisma } from "@/lib/prisma";
import { loadStaffAssignmentColorsForAgents } from "@/lib/assignee-assignment-color";
import { ensureRosterTeamsInDb } from "@/lib/roster-teams";
import {
  resolveStaffCompanyTeamId,
} from "@/lib/staff-company-scope";
import { ManualAssignmentBoard } from "./ui";

export const dynamic = "force-dynamic";

const ACTIVE_STATUSES: TicketStatus[] = ["OPEN", "IN_PROGRESS", "PENDING_INFO", "ESCALATED"];

export default async function ManualAssignmentPage() {
  const session = await requireSession();
  if (!session?.user) redirect("/signin");
  if (!["SuperAdmin", "HighAdmin", "Admin"].includes(session.user.role)) redirect("/agent");

  const companyDeptLock = roleUsesCompanyDepartmentTaskAssignScope(session.user.role);

  await ensureRosterTeamsInDb();

  let scopedCompanyFilterTeamId: string | null = null;
  let restrictSectionIds: string[] | null = null;
  let companyRosterSectionIds: string[] | null = null;
  let departmentAgentIds: string[] | null = null;
  let scopeUnavailable = false;
  let scopeNotice: string | null = null;

  if (companyDeptLock) {
    const [companyId, sectionScope] = await Promise.all([
      resolveStaffCompanyTeamId(session.user.email),
      resolveViewerOrgChartSectionScope(session.user.email),
    ]);
    if (!companyId) {
      scopeUnavailable = true;
      scopeNotice =
        "Your portal account doesn't have a designated company yet. A SuperAdmin can set one in Personnel → Portal Accounts so you can assign requests.";
    } else if (sectionScope.sectionIds.length === 0) {
      scopeUnavailable = true;
      scopeNotice =
        "Your account is not placed on the org chart. Ask a SuperAdmin to assign your department before assigning requests.";
    } else {
      scopedCompanyFilterTeamId = companyId;
      // Department scope follows org-chart membership (do not require section.companyTeamId —
      // many live sections are unlinked and that was emptying Admin boards).
      restrictSectionIds = sectionScope.sectionIds;
      departmentAgentIds = sectionScope.agentIds;
      const allSections = await listOrgChartSectionOptions();
      const companySections = filterOrgChartSectionsByCompanyTeam(allSections, companyId);
      companyRosterSectionIds =
        companySections.length > 0
          ? companySections.map((s) => s.id)
          : sectionScope.sectionIds;
    }
  }

  const [unassigned, hrisStaff, sectionOptions] = await Promise.all([
    scopeUnavailable
      ? Promise.resolve([])
      : prisma.ticket.findMany({
          where: {
            assignedAgentId: null,
            OR: [
              { status: { in: ACTIVE_STATUSES } },
              {
                status: "FOR_CONFIRMATION",
                requestType: "JOB_ORDER",
                jobOrderApprovalMeta: {
                  path: ["proceduralStep"],
                  equals: "DONE",
                },
              },
            ],
            ...(restrictSectionIds
              ? { orgChartSectionId: { in: restrictSectionIds } }
              : scopedCompanyFilterTeamId
                ? { teamId: scopedCompanyFilterTeamId }
                : {}),
          },
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            ticketNumber: true,
            title: true,
            description: true,
            priority: true,
            status: true,
            updatedAt: true,
            teamId: true,
            orgChartSectionId: true,
            requestorOrgChartSectionId: true,
          },
        }),
    scopeUnavailable
      ? Promise.resolve([])
      : loadHrisAssignableStaff({
          companyTeamId: companyDeptLock ? scopedCompanyFilterTeamId : null,
        }),
    listOrgChartSectionOptions(),
  ]);

  // Company view: designated-company HRIS roster. Departments view filters via departmentAgentIds.
  // Merge any org-chart department agents missing from the HRIS company list so Departments view is complete.
  let agentsForBoard = hrisStaff;
  if (departmentAgentIds && departmentAgentIds.length > 0) {
    const have = new Set(hrisStaff.map((a) => a.agentId));
    const missingIds = departmentAgentIds.filter((id) => !have.has(id));
    if (missingIds.length > 0) {
      const extraAgents = await prisma.agent.findMany({
        where: { id: { in: missingIds } },
        select: {
          id: true,
          name: true,
          email: true,
          team: { select: { id: true, name: true } },
        },
      });
      const extraPortals =
        extraAgents.length > 0
          ? await prisma.portalAccount.findMany({
              where: {
                OR: extraAgents.map((a) => ({
                  email: { equals: a.email, mode: "insensitive" as const },
                })),
              },
              select: {
                email: true,
                role: true,
                mergedSourceUserId: true,
              },
            })
          : [];
      const portalByEmail = new Map(
        extraPortals.map((p) => [p.email.trim().toLowerCase(), p]),
      );
      agentsForBoard = [
        ...hrisStaff,
        ...extraAgents.map((a) => {
          const portal = portalByEmail.get(a.email.trim().toLowerCase());
          return {
            mergedSourceUserId:
              portal?.mergedSourceUserId != null
                ? String(portal.mergedSourceUserId)
                : a.id,
            agentId: a.id,
            name: a.name,
            email: a.email,
            portalRole: portal?.role ?? "Personnel",
            headPrivileges: false,
            assignmentCompany: a.team
              ? { id: a.team.id, name: a.team.name }
              : null,
            teamLabel: a.team?.name ?? "Unassigned",
          };
        }),
      ];
    }
  }

  const companyRosterSections = (() => {
    if (companyRosterSectionIds && companyRosterSectionIds.length > 0) {
      const allowed = new Set(companyRosterSectionIds);
      return sectionOptions
        .filter((s) => allowed.has(s.id))
        .map((s) => ({ id: s.id, name: s.name, depth: s.depth }));
    }
    return sectionOptions.map((s) => ({ id: s.id, name: s.name, depth: s.depth }));
  })();

  const departmentRosterSections =
    restrictSectionIds && restrictSectionIds.length > 0
      ? (() => {
          const allowed = new Set(restrictSectionIds);
          return sectionOptions
            .filter((s) => allowed.has(s.id))
            .map((s) => ({ id: s.id, name: s.name, depth: s.depth }));
        })()
      : null;

  const assigneeColorByEmail = await loadStaffAssignmentColorsForAgents(
    agentsForBoard.map((a) => ({ email: a.email, name: a.name })),
  );

  const mergedIds = [
    ...new Set(agentsForBoard.map((a) => a.mergedSourceUserId.trim()).filter(Boolean)),
  ];
  const sectionIdsByMerged = new Map<string, string[]>();
  if (mergedIds.length > 0) {
    const [memberships, primaryNodes] = await Promise.all([
      prisma.orgChartNodeSectionMembership.findMany({
        where: { node: { mergedSourceUserId: { in: mergedIds } } },
        select: {
          sectionId: true,
          node: { select: { mergedSourceUserId: true } },
        },
      }),
      prisma.orgChartNode.findMany({
        where: {
          mergedSourceUserId: { in: mergedIds },
          sectionId: { not: null },
        },
        select: { mergedSourceUserId: true, sectionId: true },
      }),
    ]);
    const add = (mergedId: string, sectionId: string | null | undefined) => {
      const sid = (sectionId ?? "").trim();
      if (!sid) return;
      const list = sectionIdsByMerged.get(mergedId) ?? [];
      if (!list.includes(sid)) list.push(sid);
      sectionIdsByMerged.set(mergedId, list);
    };
    for (const m of memberships) {
      add(m.node.mergedSourceUserId, m.sectionId);
    }
    for (const n of primaryNodes) {
      add(n.mergedSourceUserId, n.sectionId);
    }
  }
  const sectionNameByOptionId = new Map(sectionOptions.map((s) => [s.id, s.name]));
  const sectionOrderIndex = new Map(sectionOptions.map((s, i) => [s.id, i]));

  function primarySectionForMerged(mergedId: string): { id: string; name: string } | null {
    const ids = sectionIdsByMerged.get(mergedId) ?? [];
    if (ids.length === 0) return null;
    ids.sort(
      (a, b) =>
        (sectionOrderIndex.get(a) ?? Number.MAX_SAFE_INTEGER) -
        (sectionOrderIndex.get(b) ?? Number.MAX_SAFE_INTEGER),
    );
    const id = ids[0]!;
    return { id, name: sectionNameByOptionId.get(id) ?? "Unknown section" };
  }

  const assignedByAgent =
    agentsForBoard.length === 0
      ? []
      : await prisma.ticket.findMany({
          where: {
            status: { in: ACTIVE_STATUSES },
            assignedAgentId: { in: agentsForBoard.map((a) => a.agentId) },
            ...(scopedCompanyFilterTeamId ? { teamId: scopedCompanyFilterTeamId } : {}),
          },
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            ticketNumber: true,
            title: true,
            description: true,
            priority: true,
            status: true,
            updatedAt: true,
            assignedAgentId: true,
            orgChartSectionId: true,
            requestorOrgChartSectionId: true,
          },
        });
  const grouped = new Map<string, typeof assignedByAgent>();
  for (const t of assignedByAgent) {
    const key = t.assignedAgentId ?? "";
    grouped.set(key, [...(grouped.get(key) ?? []), t]);
  }

  const requestTypeById = new Map<string, string>();
  const allTicketIds = [
    ...new Set([...unassigned.map((t) => t.id), ...assignedByAgent.map((t) => t.id)]),
  ];
  if (allTicketIds.length > 0) {
    const rows = await prisma.$queryRaw<Array<{ id: string; request_type: string | null }>>`
      SELECT id, request_type FROM tickets WHERE id IN (${Prisma.join(allTicketIds)})
    `;
    for (const row of rows) {
      requestTypeById.set(row.id, row.request_type ?? "ISSUE_CONCERN_TICKET");
    }
  }

  const ticketSectionIds = [
    ...new Set(
      [...unassigned, ...assignedByAgent]
        .flatMap((t) => [t.orgChartSectionId, t.requestorOrgChartSectionId])
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const sectionNameById = new Map(sectionNameByOptionId);
  const missingSectionIds = ticketSectionIds.filter((id) => !sectionNameById.has(id));
  if (missingSectionIds.length > 0) {
    const extra = await prisma.orgChartSection.findMany({
      where: { id: { in: missingSectionIds } },
      select: { id: true, name: true },
    });
    for (const s of extra) sectionNameById.set(s.id, s.name);
  }

  const toCard = (t: {
    id: string;
    ticketNumber: string;
    title: string;
    description: string;
    priority: string;
    status: string;
    updatedAt: Date;
    orgChartSectionId?: string | null;
    requestorOrgChartSectionId?: string | null;
  }) => {
    const sendToSectionId = t.orgChartSectionId ?? null;
    const requestorSectionId = t.requestorOrgChartSectionId ?? null;
    return {
      id: t.id,
      ticketNumber: t.ticketNumber,
      title: t.title,
      description: t.description,
      priority: t.priority,
      status: t.status,
      updatedAt: t.updatedAt.toISOString(),
      requestType: requestTypeById.get(t.id) ?? "ISSUE_CONCERN_TICKET",
      sendToSectionId,
      sendToSectionName: sendToSectionId ? (sectionNameById.get(sendToSectionId) ?? null) : null,
      requestorSectionId,
      requestorSectionName: requestorSectionId
        ? (sectionNameById.get(requestorSectionId) ?? null)
        : null,
    };
  };

  const personnel = agentsForBoard.map((a) => {
    const tickets = grouped.get(a.agentId) ?? [];
    const primary = primarySectionForMerged(a.mergedSourceUserId);
    return {
      agentId: a.agentId,
      name: a.name,
      role: a.portalRole ?? "Personnel",
      teamLabel: a.teamLabel,
      companyId: a.assignmentCompany?.id ?? null,
      sectionId: primary?.id ?? null,
      sectionName: primary?.name ?? null,
      assigneeColorKey: assigneeColorByEmail.get(a.email.trim().toLowerCase()) ?? null,
      cards: tickets.map(toCard),
    };
  });

  return (
    <ManualAssignmentBoard
      rosterSections={companyRosterSections}
      departmentRosterSections={departmentRosterSections}
      departmentAgentIds={departmentAgentIds}
      notice={scopeNotice}
      unassigned={unassigned.map(toCard)}
      personnel={personnel}
    />
  );
}
