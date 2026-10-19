import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { prisma } from "@/modules/platform/db/prisma";
import { permissionDenied } from "@/modules/platform/rbac/permissions";
import {
  DEFAULT_TASK_SCHEDULE_SETTINGS,
  DEFAULT_WORKING_DAYS,
} from "@/modules/platform/settings/task-schedule-settings";
import {
  getTaskScheduleSettings,
  setCompanyWorkingDays,
} from "@/modules/platform/settings/task-schedule-settings-db";

/**
 * GET /api/admin/task-schedule-settings
 * Per-company working-day masks (Task Schedule Config) + the default mask.
 */
export async function GET() {
  const { unauthorized } = await requireRole([
    "SuperAdmin",
    "HighAdmin",
    "Admin",
    "Personnel",
  ]);
  if (unauthorized) return unauthorized;

  const settings = await getTaskScheduleSettings().catch(() => DEFAULT_TASK_SCHEDULE_SETTINGS);
  return NextResponse.json(
    { ...settings, defaultWorkingDays: [...DEFAULT_WORKING_DAYS] },
    { headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=30" } },
  );
}

/**
 * PUT /api/admin/task-schedule-settings
 * SuperAdmin only. Body: { companyId: string, workingDays: number[] (1=Mon…7=Sun) }
 */
export async function PUT(req: Request) {
  const { session, unauthorized } = await requireRole(["SuperAdmin"]);
  if (unauthorized || !session) return unauthorized;
  if (session.user.role !== "SuperAdmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const denied = await permissionDenied(session, "settings.update");
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as {
    companyId?: unknown;
    workingDays?: unknown;
  };
  const companyId = typeof body.companyId === "string" ? body.companyId.trim() : "";
  if (!companyId) {
    return NextResponse.json({ error: "companyId is required." }, { status: 400 });
  }

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true },
  });
  if (!company) {
    return NextResponse.json({ error: "Unknown company." }, { status: 404 });
  }

  try {
    const saved = await setCompanyWorkingDays(companyId, body.workingDays);
    return NextResponse.json({ ...saved, defaultWorkingDays: [...DEFAULT_WORKING_DAYS] });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not save the schedule.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
