import { NextResponse } from "next/server";
import { requireSession } from "@/lib/access";
import { requirePermission } from "@/modules/platform/rbac/permissions";
import { parseSystemModuleVisibility } from "@/modules/platform/settings/system-modules";
import {
  getSystemModuleVisibility,
  setSystemModuleVisibility,
} from "@/modules/platform/settings/system-modules-db";

/**
 * GET /api/system-settings/modules
 * Any signed-in user: which modules (Requests / Tasks / Work Plans) are on.
 */
export async function GET() {
  const session = await requireSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const modules = await getSystemModuleVisibility();
  return NextResponse.json(
    { modules },
    { headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=30" } },
  );
}

/**
 * PUT /api/system-settings/modules
 * Requires `settings.update`. Body: { modules: { requests?, tasks?, work_plans?: boolean } }
 */
export async function PUT(req: Request) {
  const { unauthorized } = await requirePermission("settings.update");
  if (unauthorized) return unauthorized;

  const body = (await req.json().catch(() => ({}))) as { modules?: unknown };
  const patch = body.modules && typeof body.modules === "object" ? body.modules : {};
  const current = await getSystemModuleVisibility();
  const incoming = parseSystemModuleVisibility({ modules: { ...current, ...patch } });
  const modules = await setSystemModuleVisibility(incoming);
  return NextResponse.json({ modules });
}
