import { isElevatedUserRole } from "@/lib/auth";
import { NextResponse } from "next/server";
import type { Prisma, TicketStatus } from "@prisma/client/primary";
import { requireRole } from "@/lib/access";
import { findSessionAgentId } from "@/lib/session-agent";
import { isAgentOnDutyFromMergedDb, loadOnDutySnapshot } from "@/lib/load-on-duty-snapshot";
import { prisma } from "@/lib/prisma";
import {
  resolveAdminOnDutyCompanyFilter,
  resolveStaffCompanyTeamId,
} from "@/lib/staff-company-scope";
import {
  resolveViewerDepartmentScopeLabel,
  roleShowsDesignatedDepartmentLabel,
  sectionScopedTicketWhere,
} from "@/lib/org-chart-section-scope";
import {
  formatDepartmentDesignationWithExecutiveTitle,
  resolveExecutiveTitle,
} from "@/lib/org-chart-executive-titles";
import { resolveMergedSourceUserIdForSessionEmail } from "@/lib/approval-position-resolver";
import { countTaskBoardLanes } from "@/lib/task-board-lane-counts";
import { withTtlCache } from "@/lib/ttl-cache";
import { getWorkforceViewVisibility } from "@/lib/workforce-view-visibility-db";
import { isWorkforceViewVisible } from "@/lib/workforce-view-visibility";

export const dynamic = "force-dynamic";

type SidebarSummary = {
  open: number;
  inProgress: number;
  /** FOR_CONFIRMATION + RESOLVED (awaiting requestor sign-off). */
  forConfirmation: number;
  tasksCurrent: number;
  tasksDone: number;
  tasksDelayed: number;
  onDutyCount: number;
  onDutyPreview: Array<{ id: string; name: string; companyName: string }>;
  /** Personnel only: whether this user is clocked in today. */
  selfOnDuty: boolean | null;
  /** Mirrors SuperAdmin Workforce → Activity visibility (On Duty widget). */
  showActivity: boolean;
  /** Staff-designated / effective company label for the sidebar. */
  companyDesignation: string | null;
  /** Org-chart department scope label for the sidebar. */
  departmentDesignation: string | null;
};

async function resolveDesignations(input: {
  role: string;
  email: string | null | undefined;
}): Promise<{ companyDesignation: string | null; departmentDesignation: string | null }> {
  if (isElevatedUserRole(input.role)) {
    return {
      companyDesignation: "All companies",
      departmentDesignation: "All departments",
    };
  }

  const email = (input.email ?? "").trim();
  const [companyTeamId, departmentScopeLabel, mergedId] = await Promise.all([
    resolveStaffCompanyTeamId(email),
    roleShowsDesignatedDepartmentLabel(input.role)
      ? resolveViewerDepartmentScopeLabel(email)
      : Promise.resolve(null),
    resolveMergedSourceUserIdForSessionEmail(email),
  ]);

  let companyDesignation: string | null = null;
  if (companyTeamId) {
    const team = await prisma.team.findUnique({
      where: { id: companyTeamId },
      select: { name: true },
    });
    companyDesignation = team?.name?.trim() || null;
  }
  if (!companyDesignation && email) {
    const portal = await prisma.portalAccount.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: {
        staffDesignatedCompany: { select: { name: true } },
        company: { select: { name: true } },
        name: true,
      },
    });
    companyDesignation =
      portal?.staffDesignatedCompany?.name?.trim() ||
      portal?.company?.name?.trim() ||
      null;
  }

  let personName: string | null = null;
  if (mergedId) {
    const node = await prisma.orgChartNode.findFirst({
      where: { mergedSourceUserId: mergedId },
      select: { personName: true },
    });
    personName = node?.personName ?? null;
  }
  if (!personName && email) {
    const portal = await prisma.portalAccount.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { name: true },
    });
    personName = portal?.name ?? null;
  }

  const executiveTitle = resolveExecutiveTitle({
    mergedSourceUserId: mergedId,
    personName,
  });
  const departmentDesignation = formatDepartmentDesignationWithExecutiveTitle(
    executiveTitle,
    departmentScopeLabel,
  );

  return { companyDesignation, departmentDesignation };
}

async function buildSidebarSummary(input: {
  role: string;
  email: string | null | undefined;
  name: string | null | undefined;
  showActivity: boolean;
}): Promise<Omit<SidebarSummary, "showActivity">> {
  const isSuperAdmin = input.role === "SuperAdmin";
  const isPersonnel = input.role === "Personnel";
  const usesSectionBoardScope =
    input.role === "Admin" || input.role === "HighAdmin" || input.role === "Personnel";
  const sessionAgent = usesSectionBoardScope
    ? await findSessionAgentId({ email: input.email, name: input.name })
    : null;

  const designationsPromise = resolveDesignations({
    role: input.role,
    email: input.email,
  });

  let ticketScope: Prisma.TicketWhereInput;
  if (isSuperAdmin) {
    ticketScope = {};
  } else if (usesSectionBoardScope) {
    ticketScope = await sectionScopedTicketWhere({
      email: input.email,
      agentId: sessionAgent?.id,
    });
  } else {
    const scopedCompanyTeamId = await resolveStaffCompanyTeamId(input.email);
    ticketScope = { teamId: scopedCompanyTeamId ?? "__none__" };
  }

  const countStatus = (status: TicketStatus) =>
    prisma.ticket.count({ where: { status, ...ticketScope } });

  const countForConfirmation = () =>
    prisma.ticket.count({
      where: { status: { in: ["FOR_CONFIRMATION", "RESOLVED"] }, ...ticketScope },
    });

  if (isPersonnel) {
    const [open, inProgress, forConfirmation, selfOnDuty, taskLanes, designations] =
      await Promise.all([
        countStatus("OPEN"),
        countStatus("IN_PROGRESS"),
        countForConfirmation(),
        input.showActivity && sessionAgent?.id
          ? isAgentOnDutyFromMergedDb(sessionAgent.id)
          : Promise.resolve(false),
        countTaskBoardLanes({
          role: input.role,
          email: input.email,
          name: input.name,
        }),
        designationsPromise,
      ]);
    return {
      open,
      inProgress,
      forConfirmation,
      tasksCurrent: taskLanes.current,
      tasksDone: taskLanes.done,
      tasksDelayed: taskLanes.delayed,
      onDutyCount: selfOnDuty ? 1 : 0,
      onDutyPreview: [],
      selfOnDuty: input.showActivity ? selfOnDuty : null,
      ...designations,
    };
  }

  const onDutyCompanyFilter = await resolveAdminOnDutyCompanyFilter(input.role, input.email);

  const [open, inProgress, forConfirmation, onDuty, taskLanes, designations] = await Promise.all([
    countStatus("OPEN"),
    countStatus("IN_PROGRESS"),
    countForConfirmation(),
    input.showActivity
      ? loadOnDutySnapshot({
          page: 1,
          pageSize: 4,
          onDutyOnly: true,
          ...(onDutyCompanyFilter ? { companyFilter: onDutyCompanyFilter } : {}),
        })
      : Promise.resolve({
          onDutyCount: 0,
          agents: [] as Array<{ id: string; name: string; companyName: string }>,
        }),
    countTaskBoardLanes({
      role: input.role,
      email: input.email,
      name: input.name,
    }),
    designationsPromise,
  ]);

  return {
    open,
    inProgress,
    forConfirmation,
    tasksCurrent: taskLanes.current,
    tasksDone: taskLanes.done,
    tasksDelayed: taskLanes.delayed,
    onDutyCount: onDuty.onDutyCount,
    onDutyPreview: onDuty.agents.slice(0, 4).map((a) => ({
      id: a.id,
      name: a.name,
      companyName: a.companyName,
    })),
    selfOnDuty: null,
    ...designations,
  };
}

export async function GET() {
  const { session, unauthorized } = await requireRole(["SuperAdmin", "HighAdmin", "Admin", "Personnel"]);
  if (unauthorized || !session?.user) return unauthorized!;

  const role = session.user.role ?? "Personnel";
  const email = session.user.email ?? "";
  const visibility = await getWorkforceViewVisibility();
  const showActivity = isWorkforceViewVisible(visibility, "activity");
  const cacheKey = `sidebar-summary:${role}:${email.toLowerCase()}:activity=${showActivity ? "1" : "0"}`;

  const result = await withTtlCache(cacheKey, 30_000, () =>
    buildSidebarSummary({
      role,
      email: session.user.email,
      name: session.user.name,
      showActivity,
    }),
  );

  return NextResponse.json(
    { ...result, showActivity },
    {
      headers: { "cache-control": "private, max-age=10, stale-while-revalidate=20" },
    },
  );
}
