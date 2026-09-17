import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { parseTaskVerificationSettings } from "@/lib/task-verification-settings";
import {
  getTaskVerificationSettings,
  setTaskVerificationSettings,
} from "@/lib/task-verification-settings-db";

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
  if (unauthorized) return unauthorized;
  if (session?.user?.role !== "SuperAdmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { enabled?: unknown };
  const next = parseTaskVerificationSettings({
    enabled: typeof body.enabled === "boolean" ? body.enabled : true,
  });
  const saved = await setTaskVerificationSettings(next);
  return NextResponse.json(saved);
}
