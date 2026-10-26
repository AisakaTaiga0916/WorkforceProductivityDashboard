/** Resolves Work → Reports filters + lens access (shared by the page and CSV export). */

import type { Session } from "next-auth";
import { hasPermission, permissionSubjectFromSession } from "@/modules/platform/rbac/permissions";
import { isSystemModuleEnabled } from "@/modules/platform/settings/system-modules-db";
import type { SystemModuleId } from "@/modules/platform/settings/system-modules";
import { parseReportRange, type ReportRange } from "@/modules/reports/report-range";
import {
  resolveReportTeamFilter,
  resolveReportViewer,
  type ReportViewer,
} from "@/modules/reports/report-scope";
import {
  WORK_REPORT_LENSES,
  parseWorkReportLens,
  type WorkReportLens,
} from "@/modules/reports/work-reports";

export const WORK_REPORT_LENS_META: Record<
  WorkReportLens,
  { label: string; module: SystemModuleId; permission: string }
> = {
  tasks: { label: "Tasks", module: "tasks", permission: "tasks.read" },
  projects: { label: "Projects", module: "projects", permission: "projects.read" },
  "work-plans": { label: "Work Plans", module: "work_plans", permission: "work_plans.read" },
};

export type WorkReportContext = {
  viewer: ReportViewer;
  range: ReportRange;
  /** Lenses the viewer may open (module on + `<module>.read`). */
  lenses: WorkReportLens[];
  lens: WorkReportLens | null;
  teams: Array<{ value: string; label: string }>;
  teamId: string | null;
  teamAgentIds: Set<string> | null;
  /** Tasks lens only: requested assignee (validated against the lens' assignees). */
  assigneeParam: string | null;
};

export async function resolveWorkReportContext(
  session: Session,
  params: {
    lens?: string | null;
    range?: string | null;
    from?: string | null;
    to?: string | null;
    team?: string | null;
    assignee?: string | null;
  },
): Promise<WorkReportContext> {
  const subject = permissionSubjectFromSession(session);
  const [viewer, lensAccess] = await Promise.all([
    resolveReportViewer(session),
    Promise.all(
      WORK_REPORT_LENSES.map(async (lens) => {
        const meta = WORK_REPORT_LENS_META[lens];
        const [enabled, allowed] = await Promise.all([
          isSystemModuleEnabled(meta.module),
          hasPermission(subject, meta.permission),
        ]);
        return enabled && allowed ? lens : null;
      }),
    ),
  ]);
  const lenses = lensAccess.filter((l): l is WorkReportLens => l != null);
  const requested = parseWorkReportLens(params.lens);
  const lens = requested && lenses.includes(requested) ? requested : (lenses[0] ?? null);
  const team = await resolveReportTeamFilter(viewer, params.team);

  return {
    viewer,
    range: parseReportRange({ range: params.range, from: params.from, to: params.to }),
    lenses,
    lens,
    ...team,
    assigneeParam: lens === "tasks" ? params.assignee?.trim() || null : null,
  };
}
