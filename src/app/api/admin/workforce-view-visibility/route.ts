import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { permissionDenied } from "@/modules/platform/rbac/permissions";
import {
  getWorkforceViewVisibility,
  setWorkforceViewVisibility,
} from "@/modules/platform/settings/workforce-view-visibility-db";
import { parseWorkforceViewVisibility } from "@/modules/platform/settings/workforce-view-visibility";

/**
 * GET /api/admin/workforce-view-visibility
 * SuperAdmin / HighAdmin / Admin: which Workforce toggles are hidden.
 */
export async function GET() {
  const { unauthorized } = await requireRole(["SuperAdmin", "HighAdmin", "Admin"]);
  if (unauthorized) return unauthorized;

  const visibility = await getWorkforceViewVisibility();
  return NextResponse.json(visibility);
}

/**
 * PUT /api/admin/workforce-view-visibility
 * SuperAdmin only: hide/show ListView, Activity, and Org. Chart on Workforce.
 * Body: { hiddenViews: ("list" | "activity" | "sections")[] }
 */
export async function PUT(req: Request) {
  const { session, unauthorized } = await requireRole(["SuperAdmin"]);
  if (unauthorized || !session) return unauthorized;
  if (session.user.role !== "SuperAdmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const denied = await permissionDenied(session, "settings.update");
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as { hiddenViews?: unknown };
  const next = parseWorkforceViewVisibility({
    hiddenViews: Array.isArray(body.hiddenViews) ? body.hiddenViews : [],
  });

  if (next.hiddenViews.length >= 3) {
    return NextResponse.json(
      { error: "At least one Workforce toggle must stay visible." },
      { status: 400 },
    );
  }

  const saved = await setWorkforceViewVisibility(next);
  return NextResponse.json(saved);
}
