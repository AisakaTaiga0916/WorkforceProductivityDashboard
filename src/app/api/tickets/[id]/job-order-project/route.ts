import type { Prisma } from "@prisma/client/primary";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/access";
import {
  buildJobOrderProjectPrefill,
  projectDisplayName,
} from "@/modules/requests/job-order-project";
import {
  JO_PROJECT_REQUEST_CANCELLED_SUMMARY,
  JO_PROJECT_REQUEST_FULFILLED_SUMMARY,
  JO_PROJECT_REQUESTED_SUMMARY,
  jobOrderProjectRequestPendingFromActivities,
} from "@/modules/requests/job-order-project-request";
import { isItProjectImplementationPillar } from "@/modules/tasks/it-task-pillar-titles";
import { kpiRowInCompanyScope } from "@/modules/tasks/kpi-company-board-scope";
import { isProjectTask } from "@/modules/tasks/kpi-subkpis";
import { prisma } from "@/modules/platform/db/prisma";
import { loadAgentIdsForCompanyTeam } from "@/modules/platform/scope/staff-company-scope";
import { findSessionAgentWithTeam } from "@/lib/session-agent";
import { portalCompanyAdminPrivilegesForEmail } from "@/lib/portal-staff";
import { loadHrisAssignableStaff } from "@/modules/hierarchy/hris-staff-roster";
import { isAdminPortalRole } from "@/lib/staff-role";

/**
 * GET /api/tickets/[id]/job-order-project
 * Prefill + optional company-scoped project list for Job Order linking.
 * Also returns company Admins (for Personnel “Request Task Project”) and any pending request.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["SuperAdmin", "HighAdmin", "Admin", "Personnel"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const prefill = await buildJobOrderProjectPrefill(id);
  if (!prefill) {
    return NextResponse.json({ error: "Job Order not found." }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const listProjects = searchParams.get("listProjects") === "1";

  let projects: Array<{
    id: string;
    displayName: string;
    title: string;
    mainTask: string | null;
    itProjectName: string | null;
  }> = [];

  if (listProjects) {
    const roleIsAdmin = ["SuperAdmin", "HighAdmin", "Admin"].includes(session.user.role);
    const companyCoordinator = await portalCompanyAdminPrivilegesForEmail(session.user.email);
    const canAssignWork = roleIsAdmin || companyCoordinator;
    const operator = await findSessionAgentWithTeam({
      email: session.user.email,
      name: session.user.name,
    });
    const companyTeamId = prefill.teamId?.trim() || null;

    let where: Prisma.KpiMaintenanceWhereInput = {};
    let companyAgentIdSet: Set<string> | null = null;
    let companyFilterId: string | null = null;
    if (canAssignWork && companyTeamId) {
      // Load broadly, then apply kpiRowInCompanyScope so sub-assignee-only projects appear.
      companyFilterId = companyTeamId;
      companyAgentIdSet = new Set(await loadAgentIdsForCompanyTeam(companyTeamId));
    } else if (!canAssignWork) {
      const operatorId = operator?.id ?? null;
      where = operatorId ? { assignedAgentId: operatorId } : { id: "__none__" };
    }

    let rows = await prisma.kpiMaintenance.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: companyFilterId ? 500 : 200,
      select: {
        id: true,
        title: true,
        mainTask: true,
        itProjectName: true,
        assignedAgentId: true,
        scopedCompanyTeamId: true,
        subKpis: true,
      },
    });
    if (companyFilterId && companyAgentIdSet) {
      rows = rows.filter((r) =>
        kpiRowInCompanyScope(r, companyFilterId, companyAgentIdSet),
      );
    }

    projects = rows
      .filter((r) => isItProjectImplementationPillar(r.title) || isProjectTask(r.subKpis))
      .slice(0, 200)
      .map((r) => ({
        id: r.id,
        displayName: projectDisplayName(r),
        title: r.title,
        mainTask: r.mainTask,
        itProjectName: r.itProjectName,
      }));
  }

  let linkedProject = null as null | {
    id: string;
    displayName: string;
    title: string;
    mainTask: string | null;
    itProjectName: string | null;
  };
  if (prefill.alreadyLinkedProjectId) {
    const row = await prisma.kpiMaintenance.findUnique({
      where: { id: prefill.alreadyLinkedProjectId },
      select: { id: true, title: true, mainTask: true, itProjectName: true },
    });
    if (row) {
      linkedProject = {
        id: row.id,
        displayName: projectDisplayName(row),
        title: row.title,
        mainTask: row.mainTask,
        itProjectName: row.itProjectName,
      };
    }
  }

  const companyTeamId = prefill.teamId?.trim() || null;
  let companyAdmins: Array<{ id: string; name: string; email: string }> = [];
  if (companyTeamId) {
    const staff = await loadHrisAssignableStaff({ companyTeamId });
    const adminStaff = staff.filter(
      (s) => isAdminPortalRole(s.portalRole) || s.headPrivileges,
    );
    const agentIds = adminStaff.map((s) => s.agentId);
    const agents = agentIds.length
      ? await prisma.agent.findMany({
          where: { id: { in: agentIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const byId = new Map(agents.map((a) => [a.id, a]));
    companyAdmins = adminStaff
      .map((s) => {
        const agent = byId.get(s.agentId);
        if (!agent) return null;
        return { id: agent.id, name: agent.name, email: agent.email };
      })
      .filter((row): row is NonNullable<typeof row> => row != null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  const requestActivities = await prisma.ticketActivity.findMany({
    where: {
      ticketId: id,
      summary: {
        in: [
          JO_PROJECT_REQUESTED_SUMMARY,
          JO_PROJECT_REQUEST_FULFILLED_SUMMARY,
          JO_PROJECT_REQUEST_CANCELLED_SUMMARY,
        ],
      },
    },
    orderBy: { createdAt: "asc" },
    select: { summary: true, detail: true },
  });
  const { pending, payload } = jobOrderProjectRequestPendingFromActivities(requestActivities);

  return NextResponse.json({
    prefill,
    linkedProject,
    projects,
    companyAdmins,
    projectRequest: pending
      ? {
          pending: true,
          targetAdminAgentId: payload?.targetAdminAgentId ?? null,
          targetAdminAgentName: payload?.targetAdminAgentName ?? null,
          requestedByAgentId: payload?.requestedByAgentId ?? null,
          requestedByAgentName: payload?.requestedByAgentName ?? null,
          note: payload?.note ?? null,
        }
      : { pending: false },
  });
}
