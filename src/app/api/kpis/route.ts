import { isElevatedUserRole } from "@/modules/platform/auth";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { computeKpis, parseHelpdeskCadence, parseKpiRangeFromQuery } from "@/modules/tasks/kpis";
import { resolveAgentIdsForOrgChartSection } from "@/modules/hierarchy/org-chart-section-roster";
import { resolveViewerOrgChartSectionScope } from "@/modules/platform/scope/org-chart-section-scope";
import { prisma } from "@/modules/platform/db/prisma";
import { listActiveCompanies } from "@/modules/platform/companies/company-directory";
import {
  canAccessCompany,
  getCompanyAccess,
  resolveViewerCompanyId,
} from "@/modules/platform/scope/company-access";
import { resolveAgentCompanyIds } from "@/modules/platform/scope/staff-company-scope";
import { findSessionAgentId } from "@/lib/session-agent";

export async function GET(req: Request) {
  const startedAt = Date.now();
  const { session, unauthorized } = await requireRole(["SuperAdmin", "HighAdmin", "Admin", "Personnel"]);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(req.url);
  const { from, to } = parseKpiRangeFromQuery(searchParams.get("from"), searchParams.get("to"));

  const operator =
    session?.user?.role === "Personnel"
      ? await findSessionAgentId({ email: session.user.email, name: session.user.name })
      : null;
  const requestedAgentId = searchParams.get("agentId")?.trim() || null;
  const departmentSectionId =
    searchParams.get("department")?.trim() || searchParams.get("section")?.trim() || null;
  const departmentId =
    departmentSectionId && departmentSectionId !== "ALL" ? departmentSectionId : null;

  let assignedAgentId: string | undefined =
    session?.user?.role === "Personnel" ? operator?.id ?? "__none__" : undefined;
  let assignedAgentIds: string[] | undefined;

  /**
   * Company scope uses routed-to team (`ticket.teamId`) — same as Request / Company boards —
   * not assignee designated-company membership.
   */
  let teamId: string | undefined;
  let teamIds: string[] | undefined;

  if (session?.user?.role !== "Personnel" && requestedAgentId) {
    const agent = await prisma.agent.findUnique({
      where: { id: requestedAgentId },
      select: { id: true, name: true },
    });
    if (!agent) {
      return NextResponse.json({ error: "Personnel not found." }, { status: 404 });
    }
    if (session.user.role === "Admin") {
      const scoped = await resolveViewerCompanyId(session);
      if (!scoped) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const agentCompanyIds = await resolveAgentCompanyIds(requestedAgentId);
      if (!agentCompanyIds.includes(scoped)) {
        return NextResponse.json({ error: "Forbidden personnel filter." }, { status: 403 });
      }
    }
    assignedAgentId = requestedAgentId;
  } else if (session?.user?.role === "Admin") {
    const access = await getCompanyAccess(session);
    const requested = searchParams.get("companyId")?.trim() || null;
    // Never fall back to an arbitrary client companyId — Admins without a company see nothing.
    if (requested && requested !== "ALL" && !canAccessCompany(access, requested)) {
      return NextResponse.json({ error: "Forbidden company filter." }, { status: 403 });
    }
    teamId =
      requested && requested !== "ALL" ? requested : (access.currentCompanyId ?? "__none__");
  } else if (isElevatedUserRole(session?.user?.role)) {
    const requested = searchParams.get("companyId")?.trim() || null;
    if (requested && requested !== "ALL") {
      teamId = requested;
    } else {
      teamIds = (await listActiveCompanies()).map((t) => t.id);
    }
  }

  // Org-chart department: tickets whose assignee is in the section (incl. subsections).
  // Skipped when a single agent is already selected (search wins).
  if (!assignedAgentId && departmentId && session?.user?.role !== "Personnel") {
    if (session?.user?.role === "Admin") {
      const sectionScope = await resolveViewerOrgChartSectionScope(session.user.email);
      if (!sectionScope.sectionIds.includes(departmentId)) {
        return NextResponse.json({ error: "Forbidden department filter." }, { status: 403 });
      }
    }
    assignedAgentIds = await resolveAgentIdsForOrgChartSection(departmentId);
  }

  const helpdeskCadence = parseHelpdeskCadence(searchParams.get("helpdeskCadence"));
  const kpis = await computeKpis(
    { from, to },
    { assignedAgentId, assignedAgentIds, teamId, teamIds },
    { helpdeskCadence },
  );
  if (process.env.NODE_ENV === "development") {
    console.info(
      `[perf] GET /api/kpis ${Date.now() - startedAt}ms from=${from.toISOString()} to=${to.toISOString()}`,
    );
  }
  return NextResponse.json(kpis, {
    headers: {
      "cache-control": "private, no-store, max-age=0",
    },
  });
}
