import { NextResponse } from "next/server";
import { requireSession } from "@/lib/access";
import { permissionDenied } from "@/modules/platform/rbac/permissions";
import { parseIntakeRequestTypeVisibility } from "@/modules/platform/settings/intake-request-type-visibility";
import {
  getIntakeRequestTypeVisibility,
  setIntakeRequestTypeVisibility,
} from "@/modules/platform/settings/intake-request-type-visibility-db";

/** SuperAdmin-only guard. Writes additionally require the given RBAC permission. */
async function guardSuperAdmin(permissionKey?: string) {
  const session = await requireSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "SuperAdmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (permissionKey) {
    const denied = await permissionDenied(session, permissionKey);
    if (denied) return denied;
  }
  return null;
}

export async function GET() {
  const denied = await guardSuperAdmin();
  if (denied) return denied;
  const config = await getIntakeRequestTypeVisibility();
  return NextResponse.json(config);
}

export async function PUT(req: Request) {
  const denied = await guardSuperAdmin("settings.update");
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as { hiddenTypeIds?: unknown };
  try {
    const config = await setIntakeRequestTypeVisibility(
      parseIntakeRequestTypeVisibility(body),
    );
    return NextResponse.json(config);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not save intake request types." },
      { status: 400 },
    );
  }
}

export async function POST() {
  /** Reset — show all request types. */
  const denied = await guardSuperAdmin("settings.update");
  if (denied) return denied;
  const config = await setIntakeRequestTypeVisibility({ hiddenTypeIds: [] });
  return NextResponse.json(config);
}
