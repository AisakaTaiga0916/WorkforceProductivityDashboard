import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { loadPersonnelAccountsPayload } from "@/lib/personnel-accounts-data";
import { getCompanyAccess } from "@/modules/platform/scope/company-access";
import { permissionDenied } from "@/modules/platform/rbac/permissions";
import { parsePersonnelKpiRange } from "@/modules/workforce/personnel-kpi-range";
import {
  loadPersonnelKpiDetail,
  loadPersonnelKpiOverview,
} from "@/modules/workforce/personnel-kpi-server";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/workforce-kpi
 * Company-scoped, read-only KPI lens for Workforce.
 *
 * - `?mode=summary&range=month|quarter|year|custom&from=YYYY-MM-DD&to=YYYY-MM-DD`
 * - `?mode=detail&user=<mergedSourceUserId>&range=...`
 */
export async function GET(req: Request) {
  const { session, unauthorized } = await requireRole(["SuperAdmin", "HighAdmin", "Admin"]);
  if (unauthorized || !session) return unauthorized;
  const denied = await permissionDenied(session, "tasks.read");
  if (denied) return denied;

  const url = new URL(req.url);
  const range = parsePersonnelKpiRange({
    range: url.searchParams.get("range"),
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
  });
  const access = await getCompanyAccess(session);
  const payload = await loadPersonnelAccountsPayload({
    role: session.user.role,
    currentCompanyId: access.currentCompanyId,
  });

  const mode = url.searchParams.get("mode") === "detail" ? "detail" : "summary";
  if (mode === "summary") {
    const overview = await loadPersonnelKpiOverview({
      personnel: payload.personnel,
      companyId: access.currentCompanyId,
      range,
    });
    return NextResponse.json(overview);
  }

  const sourceUserId = url.searchParams.get("user")?.trim() ?? "";
  const person = payload.personnel.find((row) => row.mergedSourceUserId === sourceUserId);
  if (!person) {
    return NextResponse.json({ error: "Person not found" }, { status: 404 });
  }

  const detail = await loadPersonnelKpiDetail({
    personnel: payload.personnel,
    person,
    companyId: access.currentCompanyId,
    range,
  });
  return NextResponse.json(detail);
}
