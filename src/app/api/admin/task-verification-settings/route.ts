import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { permissionDenied } from "@/modules/platform/rbac/permissions";
import { parseTaskVerificationSettings } from "@/modules/platform/settings/task-verification-settings";
import {
  getTaskVerificationSettings,
  setTaskVerificationSettings,
} from "@/modules/platform/settings/task-verification-settings-db";

/**
 * GET /api/admin/task-verification-settings
 * Staff can read so Task Board / Task Management can hide verification UI when off.
 */
export async function GET() {
  const { unauthorized } = await requireRole([
    "SuperAdmin",
    "HighAdmin",
    "Admin",
    "Personnel",
  ]);
  if (unauthorized) return unauthorized;

  const settings = await getTaskVerificationSettings();
  return NextResponse.json(settings, {
    headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=30" },
  });
}

/**
 * PUT /api/admin/task-verification-settings
 * SuperAdmin only. Body: { enabled: boolean }
 */
export async function PUT(req: Request) {
  const { session, unauthorized } = await requireRole(["SuperAdmin"]);
  if (unauthorized || !session) return unauthorized;
  if (session.user.role !== "SuperAdmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const denied = await permissionDenied(session, "settings.update");
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as { enabled?: unknown };
  const next = parseTaskVerificationSettings({
    enabled: typeof body.enabled === "boolean" ? body.enabled : true,
  });
  const saved = await setTaskVerificationSettings(next);
  return NextResponse.json(saved);
}
