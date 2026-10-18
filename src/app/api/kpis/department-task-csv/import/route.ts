import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { permissionDenied } from "@/modules/platform/rbac/permissions";
import { resolveOpsPermissions } from "@/lib/ops-permissions";
import { importDepartmentTasksFromCsv } from "@/modules/tasks/department-task-csv-import";
import { normalizeTimeZone } from "@/modules/tasks/kpi-recurrence";

/**
 * POST /api/kpis/department-task-csv/import
 * Body: multipart file field "file", or raw text/csv / JSON { csv, tz? }
 */
export async function POST(req: Request) {
  const { session, unauthorized } = await requireRole([
    "SuperAdmin",
    "HighAdmin",
    "Admin",
  ]);
  if (unauthorized || !session) return unauthorized;

  const perms = await resolveOpsPermissions(session);
  if (!perms.canAssignWork) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const denied = await permissionDenied(session, "tasks.create");
  if (denied) return denied;

  const contentType = req.headers.get("content-type") ?? "";
  let csv = "";
  let timeZone: string | undefined;

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      const tzField = form.get("tz");
      if (typeof tzField === "string" && tzField.trim()) timeZone = tzField.trim();
      if (file instanceof File) {
        csv = await file.text();
      } else if (typeof file === "string") {
        csv = file;
      }
    } else if (contentType.includes("application/json")) {
      const body = (await req.json()) as { csv?: string; tz?: string };
      csv = typeof body.csv === "string" ? body.csv : "";
      if (typeof body.tz === "string") timeZone = body.tz;
    } else {
      csv = await req.text();
    }
  } catch {
    return NextResponse.json({ error: "Could not read upload body." }, { status: 400 });
  }

  if (!csv.trim()) {
    return NextResponse.json({ error: "CSV content is required." }, { status: 400 });
  }

  const result = await importDepartmentTasksFromCsv(csv, {
    timeZone: normalizeTimeZone(timeZone),
    createdBy: session.user.email ?? session.user.name ?? "admin",
    createdByRole: session.user.role ?? "Admin",
  });

  const hasWork =
    result.created.length > 0 || result.skipped.length > 0 || result.errors.length > 0;
  if (!hasWork) {
    return NextResponse.json({ error: "No rows imported.", ...result }, { status: 400 });
  }

  return NextResponse.json(
    {
      ok: result.errors.length === 0 || result.created.length > 0,
      ...result,
    },
    {
      status: result.created.length > 0 || result.skipped.length > 0 ? 200 : 400,
      headers: { "cache-control": "private, no-store, max-age=0" },
    },
  );
}
