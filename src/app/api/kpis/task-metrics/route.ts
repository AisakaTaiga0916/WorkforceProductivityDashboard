import { isElevatedUserRole } from "@/modules/platform/auth";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import {
  computeTaskMetrics,
  parseHelpdeskCadence,
  parseKpiRangeFromQuery,
} from "@/modules/tasks/kpis";
import { normalizeTimeZone } from "@/modules/tasks/kpi-recurrence";
import { findSessionAgentId } from "@/lib/session-agent";
import { loadAgentIdsForCompanyTeam } from "@/modules/platform/scope/staff-company-scope";
import { resolveViewerCompanyFilter } from "@/modules/platform/scope/company-access";
import { getCompanyWorkingDays } from "@/modules/platform/settings/task-schedule-settings-db";
import { parseTaskMetricsTaskTypeFilter } from "@/modules/tasks/task-metrics-task-type";

export async function GET(req: Request) {
  const startedAt = Date.now();
  const { session, unauthorized } = await requireRole(["SuperAdmin", "HighAdmin", "Admin", "Personnel"]);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(req.url);
  const { from, to } = parseKpiRangeFromQuery(searchParams.get("from"), searchParams.get("to"));
  const helpdeskCadence = parseHelpdeskCadence(searchParams.get("helpdeskCadence"));
  const taskType = parseTaskMetricsTaskTypeFilter(searchParams.get("taskType"));

  const operator =
    session?.user?.role === "Personnel"
      ? await findSessionAgentId({ email: session.user.email, name: session.user.name })
      : null;
  const assignedAgentId = session?.user?.role === "Personnel" ? operator?.id ?? "__none__" : undefined;
  const requestedCompanyId = searchParams.get("companyId")?.trim() || null;
  const companyId =
    session?.user?.role === "Admin"
      ? await resolveViewerCompanyFilter(session, requestedCompanyId)
      : isElevatedUserRole(session?.user?.role)
        ? requestedCompanyId
        : null;
  // Apply the company scope for SuperAdmin too, so the personnel view matches
  // the company the report claims to show. Members = anyone with access to the
  // company, including agent rows reached via legacy emails.
  const assignedAgentIds =
    companyId && companyId !== "ALL" ? await loadAgentIdsForCompanyTeam(companyId) : undefined;
  const companyWorkingDays = await getCompanyWorkingDays(
    companyId && companyId !== "ALL" ? companyId : null,
  );

  const timeZone = normalizeTimeZone(searchParams.get("tz"));
  const payload = await computeTaskMetrics(
    { from, to },
    { assignedAgentId, assignedAgentIds },
    helpdeskCadence,
    { timeZone, taskType, workingDays: companyWorkingDays },
  );
  if (process.env.NODE_ENV === "development") {
    console.info(
      `[perf] GET /api/kpis/task-metrics ${Date.now() - startedAt}ms cadence=${helpdeskCadence} taskType=${taskType} from=${from.toISOString()} to=${to.toISOString()}`,
    );
  }
  return NextResponse.json(payload, {
    headers: {
      "cache-control": "private, no-store, max-age=0",
    },
  });
}
