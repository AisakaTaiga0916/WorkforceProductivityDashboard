import { isElevatedUserRole } from "@/lib/auth";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { computeDepartmentTaskMetrics } from "@/lib/department-task-metrics";
import {
  filterHiddenDepartmentSections,
  getDepartmentMetricsVisibility,
} from "@/lib/department-metrics-visibility";
import { parseKpiRangeFromQuery } from "@/lib/kpis";
import { normalizeTimeZone } from "@/lib/kpi-recurrence";
import { prisma } from "@/lib/prisma";
import {
  resolveViewerOrgChartSectionScope,
  roleShowsDesignatedDepartmentLabel,
} from "@/lib/org-chart-section-scope";
import { resolveStaffCompanyTeamId } from "@/lib/staff-company-scope";
import { parseTaskMetricsCadence } from "@/lib/task-metrics-range";

function rangeToYmd(from: Date, to: Date): { fromYmd: string; toYmd: string } {
  const ymd = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return { fromYmd: ymd(from), toYmd: ymd(to) };
}

export async function GET(req: Request) {
  const startedAt = Date.now();
  const { session, unauthorized } = await requireRole([
    "SuperAdmin",
    "HighAdmin",
    "Admin",
    "Personnel",
  ]);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(req.url);
  const { from, to } = parseKpiRangeFromQuery(searchParams.get("from"), searchParams.get("to"));
  const { fromYmd, toYmd } = rangeToYmd(from, to);
  const metricsCadence = parseTaskMetricsCadence(
    searchParams.get("helpdeskCadence") ?? searchParams.get("metricsCadence"),
  );
  const timeZone = normalizeTimeZone(searchParams.get("tz"));
  const role = session?.user?.role;

  const companyId =
    role === "Admin"
      ? (await resolveStaffCompanyTeamId(session.user.email)) ?? "__none__"
      : isElevatedUserRole(role)
        ? searchParams.get("companyId")?.trim() || null
        : null;

  if (companyId === "__none__") {
    return NextResponse.json({ sections: [], hiddenSectionIds: [] });
  }

  let onlyMergedSourceUserId: string | null = null;
  let allowedSectionIds: string[] | null = null;

  if (role === "Personnel") {
    const email = session.user.email?.trim();
    if (!email) {
      return NextResponse.json({ sections: [], hiddenSectionIds: [] });
    }
    const portal = await prisma.portalAccount.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { mergedSourceUserId: true },
    });
    if (portal?.mergedSourceUserId == null) {
      return NextResponse.json({ sections: [], hiddenSectionIds: [] });
    }
    onlyMergedSourceUserId = portal.mergedSourceUserId.toString();
  } else if (roleShowsDesignatedDepartmentLabel(role)) {
    // Admin: designated org-chart departments (membership + headed sections + descendants).
    const sectionScope = await resolveViewerOrgChartSectionScope(session.user.email);
    if (sectionScope.sectionIds.length === 0) {
      return NextResponse.json({ sections: [], hiddenSectionIds: [] });
    }
    allowedSectionIds = sectionScope.sectionIds;
  }

  const [payload, visibility] = await Promise.all([
    computeDepartmentTaskMetrics({
      fromYmd,
      toYmd,
      metricsCadence,
      timeZone,
      companyTeamId: companyId && companyId !== "ALL" ? companyId : null,
      allowedSectionIds,
      onlyMergedSourceUserId,
    }),
    getDepartmentMetricsVisibility(),
  ]);

  const hiddenSectionIds = visibility.hiddenSectionIds;
  const sections = filterHiddenDepartmentSections(payload.sections, hiddenSectionIds);

  if (process.env.NODE_ENV === "development") {
    console.info(
      `[perf] GET /api/kpis/department-metrics ${Date.now() - startedAt}ms cadence=${metricsCadence} from=${fromYmd} to=${toYmd} sections=${sections.length}`,
    );
  }

  return NextResponse.json(
    {
      sections,
      hiddenSectionIds,
    },
    {
      headers: {
        "cache-control": "private, no-store, max-age=0",
      },
    },
  );
}
