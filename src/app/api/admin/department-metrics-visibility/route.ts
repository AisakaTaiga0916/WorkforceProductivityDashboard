import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { permissionDenied } from "@/modules/platform/rbac/permissions";
import {
  getDepartmentMetricsVisibility,
  parseDepartmentMetricsVisibility,
  setDepartmentMetricsVisibility,
} from "@/modules/platform/settings/department-metrics-visibility";
import { prisma } from "@/modules/platform/db/prisma";

/**
 * GET /api/admin/department-metrics-visibility
 * SuperAdmin / HighAdmin / Admin: read hidden section ids + section catalog.
 */
export async function GET() {
  const { unauthorized } = await requireRole(["SuperAdmin", "HighAdmin", "Admin"]);
  if (unauthorized) return unauthorized;

  const [visibility, sections] = await Promise.all([
    getDepartmentMetricsVisibility(),
    prisma.orgChartSection.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, parentId: true, sortOrder: true },
    }),
  ]);

  return NextResponse.json({
    ...visibility,
    sections,
  });
}

/**
 * PUT /api/admin/department-metrics-visibility
 * SuperAdmin only: set which org-chart sections are hidden in Departments metrics.
 * Body: { hiddenSectionIds: string[] }
 */
export async function PUT(req: Request) {
  const { session, unauthorized } = await requireRole(["SuperAdmin"]);
  if (unauthorized || !session) return unauthorized;
  if (session.user.role !== "SuperAdmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const denied = await permissionDenied(session, "settings.update");
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as { hiddenSectionIds?: unknown };
  const next = parseDepartmentMetricsVisibility({
    hiddenSectionIds: Array.isArray(body.hiddenSectionIds) ? body.hiddenSectionIds : [],
  });

  // Keep only ids that still exist.
  const existing = await prisma.orgChartSection.findMany({
    where: { id: { in: next.hiddenSectionIds } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((s) => s.id));
  const saved = await setDepartmentMetricsVisibility({
    hiddenSectionIds: next.hiddenSectionIds.filter((id) => existingIds.has(id)),
  });

  return NextResponse.json(saved);
}
