import { NextResponse } from "next/server";
import { requireSession } from "@/lib/access";
import { permissionDenied } from "@/modules/platform/rbac/permissions";
import { csvDownloadResponse, toCsv } from "@/modules/reports/report-range";
import { resolveWorkReportContext } from "@/modules/reports/work-report-context";
import {
  loadProjectWorkReport,
  loadTaskWorkReport,
  loadWorkPlanWorkReport,
} from "@/modules/reports/work-reports";

const STAFF_ROLES = ["SuperAdmin", "HighAdmin", "Admin", "Personnel"];

type Row = Array<string | number | null>;

/** GET /api/reports/work/export?lens=tasks|projects|work-plans&from&to&company&team (CSV). */
export async function GET(req: Request) {
  const session = await requireSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!STAFF_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const denied = await permissionDenied(session, "reports.export");
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const ctx = await resolveWorkReportContext(session, {
    lens: searchParams.get("lens"),
    range: searchParams.get("range"),
    from: searchParams.get("from"),
    to: searchParams.get("to"),
    team: searchParams.get("team"),
    assignee: searchParams.get("assignee"),
  });
  const requested = searchParams.get("lens");
  if (!ctx.lens || (requested && requested !== ctx.lens)) {
    return NextResponse.json({ error: "Report not available." }, { status: 403 });
  }

  const input = { session, ...ctx };
  const rows: Row[] = [
    ["Company", ctx.viewer.companyLabel],
    ["Range", ctx.range.fromYmd, ctx.range.toYmd],
    [],
  ];
  if (ctx.lens === "tasks") {
    const r = await loadTaskWorkReport(input);
    rows.push(
      ["Board", "Current", "Delayed", "Done"],
      ["", r.board.current, r.board.delayed, r.board.done],
      [],
      ["Due in range", "Completed of due", "Completed in range", "On-time", "On-time basis"],
      [r.dueInRange, r.completedOfDue, r.completedInRange, r.onTimeCompleted, r.onTimeBasis],
      [],
      ["Assignee", "Open", "Delayed", "Done"],
      ...r.byAssignee.map((a): Row => [a.name, a.open, a.delayed, a.done]),
    );
  } else if (ctx.lens === "projects") {
    const r = await loadProjectWorkReport(input);
    rows.push(
      ["Status", "Count"],
      ...r.byStatus.map((s): Row => [s.label, s.count]),
      [],
      ["At-risk project", "Status", "Target", "Lead"],
      ...r.atRiskProjects.map((p): Row => [p.title, p.status, p.dueDate, p.lead]),
      [],
      ["Delayed phase", "Project", "Target", "Days late"],
      ...r.delayedPhases.map((p): Row => [p.phaseName, p.projectTitle, p.dueDate, p.daysLate]),
    );
  } else {
    const r = await loadWorkPlanWorkReport(input);
    rows.push(
      ["Submitted in range", "Pending now", "Median cycle (h)", "Cycle basis"],
      [
        r.submittedInRange,
        r.pendingNow,
        r.medianCycleHours != null ? Math.round(r.medianCycleHours * 10) / 10 : null,
        r.cycleBasis,
      ],
      [],
      ["Outcome", "Count"],
      ...r.outcomes.map((o): Row => [o.label, o.count]),
      [],
      ["Pending at level", "Count"],
      ...r.pendingByLevel.map((p): Row => [p.label, p.count]),
    );
  }
  return csvDownloadResponse(
    `work-${ctx.lens}-${ctx.range.fromYmd}-to-${ctx.range.toYmd}.csv`,
    toCsv(rows),
  );
}
