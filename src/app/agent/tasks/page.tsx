import { isElevatedUserRole } from "@/modules/platform/auth";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/access";
import { isSystemModuleEnabled } from "@/modules/platform/settings/system-modules-db";
import { ModuleDisabledNotice } from "@/components/ModuleDisabledNotice";
import { BRAND_TITLE } from "@/lib/brand";
import { rosterTeamNameFilter, sortByRosterOrder } from "@/lib/company-roster";
import { buildOrgChartDepartmentFilterOptions } from "@/modules/hierarchy/org-chart-section-display";
import { listOrgChartSectionOptions } from "@/modules/hierarchy/org-chart-section-roster";
import { prisma } from "@/modules/platform/db/prisma";
import { resolveStaffCompanyTeamId } from "@/modules/platform/scope/staff-company-scope";
import { TASK_FREQUENCY_DONUT_KEYS } from "@/modules/tasks/task-metrics-task-type";
import { AgentKpiKanbanFlow } from "../kpi-kanban-flow";
import { TaskBoardFilterBar } from "./task-board-filter-bar";

export const dynamic = "force-dynamic";

function firstQuery(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function frequencyOptionLabel(key: string) {
  if (key === "ONE-OFF") return "One-off";
  if (key === "SEMI_ANNUAL") return "Semi Annual";
  if (key === "YEARLY") return "Annualy";
  return key.charAt(0) + key.slice(1).toLowerCase();
}

export default async function AgentTasksPage({
  searchParams,
}: {
  searchParams: Promise<{
    task?: string | string[];
    fromJobOrder?: string | string[];
    q?: string | string[];
    category?: string | string[];
    frequency?: string | string[];
    company?: string | string[];
    department?: string | string[];
  }>;
}) {
  const session = await requireSession();
  if (!session?.user) redirect("/signin");
  if (!["SuperAdmin", "HighAdmin", "Personnel", "Admin"].includes(session.user.role)) redirect("/");
  if (!(await isSystemModuleEnabled("tasks"))) return <ModuleDisabledNotice module="tasks" />;

  const params = await searchParams;
  const focusTaskId = firstQuery(params.task)?.trim() || null;
  const fromJobOrderTicketId = firstQuery(params.fromJobOrder)?.trim() || null;
  const searchQuery = (firstQuery(params.q) ?? "").replace(/^#/, "").trim();

  const categoryFilter = (() => {
    const v = firstQuery(params.category) ?? "all";
    return v === "task" || v === "project" || v === "field" ? v : "all";
  })();

  const frequencyFilter = (() => {
    const v = (firstQuery(params.frequency) ?? "all").trim();
    return TASK_FREQUENCY_DONUT_KEYS.includes(v as (typeof TASK_FREQUENCY_DONUT_KEYS)[number])
      ? v
      : "all";
  })();

  const isElevated = isElevatedUserRole(session.user.role);
  const isAdminRole = isElevated || session.user.role === "Admin";
  const showCompanyFilter = isAdminRole;

  const [allTeams, orgChartSections] = await Promise.all([
    showCompanyFilter
      ? sortByRosterOrder(
          await prisma.team.findMany({
            where: rosterTeamNameFilter(),
            select: { id: true, name: true },
          }),
        )
      : Promise.resolve([] as Array<{ id: string; name: string }>),
    listOrgChartSectionOptions(),
  ]);

  const scopedAdminCompanyId =
    session.user.role === "Admin" ? await resolveStaffCompanyTeamId(session.user.email) : null;

  const companies =
    session.user.role === "Admin" && scopedAdminCompanyId
      ? allTeams.filter((t) => t.id === scopedAdminCompanyId)
      : allTeams;

  const companyFromUrl = (firstQuery(params.company) ?? "").trim();
  const companyFilterTeamId = (() => {
    if (session.user.role === "Admin" && scopedAdminCompanyId) return scopedAdminCompanyId;
    if (!showCompanyFilter) return null;
    if (!companyFromUrl || companyFromUrl === "ALL") return null;
    return companies.some((c) => c.id === companyFromUrl) ? companyFromUrl : null;
  })();

  const departmentFromUrl = (firstQuery(params.department) ?? "").trim();
  const departmentFilterSectionId =
    departmentFromUrl &&
    departmentFromUrl !== "ALL" &&
    orgChartSections.some((s) => s.id === departmentFromUrl)
      ? departmentFromUrl
      : null;

  const categoryOptions = [
    { value: "all", label: "All categories" },
    { value: "task", label: "Task" },
    { value: "project", label: "Project" },
    { value: "field", label: "Field Assignment" },
  ];

  const frequencyOptions = [
    { value: "all", label: "All frequencies" },
    ...TASK_FREQUENCY_DONUT_KEYS.map((key) => ({
      value: key,
      label: frequencyOptionLabel(key),
    })),
  ];

  const companyOptions = companies.map((c) => ({ value: c.id, label: c.name }));
  const departmentOptions = buildOrgChartDepartmentFilterOptions(orgChartSections);

  return (
    <main className="flex min-h-[calc(100vh-56px)] flex-col bg-zinc-50 px-3 py-4 text-zinc-900 dark:bg-background dark:text-zinc-100 sm:px-4">
      <div className="mx-auto flex w-full max-w-[96rem] flex-1 flex-col space-y-4">
        <section className="space-y-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-orange-700 dark:text-orange-400/95">
              {BRAND_TITLE} · Tasks
            </p>
            <h1 className="mt-1 text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 sm:mt-1.5 sm:text-2xl">
              Task Board
            </h1>
            <p className="mt-1 hidden text-sm text-zinc-600 dark:text-zinc-400 sm:block">
              Projects, running tasks, and travel-linked field work.
            </p>
          </div>

          <section className="min-w-0">
            <div className="mb-3 sm:mb-4">
              <TaskBoardFilterBar
                initialQuery={searchQuery}
                placeholder="Search tasks by title"
                savedFilterStorageKey={`saved-task-filters:${session.user.email}:v2`}
                company={
                  showCompanyFilter && companies.length > 0 && session.user.role !== "Admin"
                    ? {
                        visible: true,
                        value: companyFilterTeamId || "ALL",
                        emptyValue: "ALL",
                        options: companyOptions,
                      }
                    : { visible: false, value: "ALL", options: [] }
                }
                department={{
                  visible: departmentOptions.length > 0,
                  value: departmentFilterSectionId || "ALL",
                  emptyValue: "ALL",
                  options: departmentOptions,
                }}
                category={{
                  visible: true,
                  value: categoryFilter,
                  options: categoryOptions,
                }}
                frequency={{
                  visible: true,
                  value: frequencyFilter,
                  options: frequencyOptions,
                }}
              />
            </div>
            <AgentKpiKanbanFlow
              companyFilterTeamId={companyFilterTeamId}
              orgChartSectionFilterId={departmentFilterSectionId}
              sessionRole={session.user.role}
              showAdminTaskManagement={isAdminRole}
              focusTaskId={focusTaskId}
              fromJobOrderTicketId={fromJobOrderTicketId}
              searchQuery={searchQuery}
              categoryFilter={categoryFilter}
              frequencyFilter={frequencyFilter}
            />
          </section>
        </section>
      </div>
    </main>
  );
}
