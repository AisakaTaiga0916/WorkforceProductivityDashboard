import { NextResponse } from "next/server";
import { requireSession } from "@/lib/access";
import { permissionDenied } from "@/modules/platform/rbac/permissions";
import { applyProjectAction, resolveProjectViewer } from "@/modules/projects/project-service";

const BOARD_ROLES = ["SuperAdmin", "HighAdmin", "Admin", "Personnel"];

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!BOARD_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const denied = await permissionDenied(session, "projects.update");
  if (denied) return denied;

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const viewer = await resolveProjectViewer(session);
  const result = await applyProjectAction(viewer, id, body);
  return NextResponse.json(result.body, { status: result.status });
}
