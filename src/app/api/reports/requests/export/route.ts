import { NextResponse } from "next/server";
import { requireSession } from "@/lib/access";
import { isSystemModuleEnabled } from "@/modules/platform/settings/system-modules-db";
import { permissionDenied } from "@/modules/platform/rbac/permissions";
import { csvDownloadResponse, toCsv } from "@/modules/reports/report-range";
import { loadRequestReportExportRows } from "@/modules/requests/request-reports";
import { resolveRequestReportContext } from "@/modules/requests/request-report-scope";

const STAFF_ROLES = ["SuperAdmin", "HighAdmin", "Admin", "Personnel"];

/** GET /api/reports/requests/export?range|from&to&team&type&status — ticket rows created in range (CSV). */
export async function GET(req: Request) {
  const session = await requireSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!STAFF_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const denied = await permissionDenied(session, "reports.export", "requests.read");
  if (denied) return denied;
  if (!(await isSystemModuleEnabled("requests"))) {
    return NextResponse.json({ error: "Requests module is turned off." }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const ctx = await resolveRequestReportContext(session, {
    range: searchParams.get("range"),
    from: searchParams.get("from"),
    to: searchParams.get("to"),
    team: searchParams.get("team"),
    type: searchParams.get("type"),
    status: searchParams.get("status"),
  });
  const rows = await loadRequestReportExportRows({ where: ctx.where, range: ctx.range });
  return csvDownloadResponse(`requests-${ctx.range.fromYmd}-to-${ctx.range.toYmd}.csv`, toCsv(rows));
}
