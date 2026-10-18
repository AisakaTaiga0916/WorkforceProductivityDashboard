import { NextResponse } from "next/server";
import { importMergedUsers, readMergedDump } from "@/modules/platform/auth/merged-user-import";
import { requirePermission } from "@/modules/platform/rbac/permissions";

export const maxDuration = 300;

/**
 * POST /api/admin/iam/import  (users.create)
 * Ops action: one-off batch import from the merged dump into main users.
 * Body: { dryRun?: boolean }
 */
export async function POST(req: Request) {
  const { unauthorized } = await requirePermission("users.create");
  if (unauthorized) return unauthorized;

  const body = (await req.json().catch(() => ({}))) as { dryRun?: unknown };
  let rows;
  try {
    rows = await readMergedDump();
  } catch (e) {
    console.error("[iam/import] reading merged dump failed", e);
    return NextResponse.json(
      { error: "Could not read the merged dump. Check MERGED_IMPORT_DATABASE_URL." },
      { status: 502 },
    );
  }

  const summary = await importMergedUsers(rows, { dryRun: body.dryRun === true });
  return NextResponse.json({
    ...summary,
    conflicts: summary.conflicts.slice(0, 50),
    errors: summary.errors.slice(0, 50),
  });
}
