import { TicketPriority } from "@prisma/client/primary";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/access";
import { permissionDenied } from "@/modules/platform/rbac/permissions";
import { prisma } from "@/modules/platform/db/prisma";

const priorities = new Set(Object.values(TicketPriority));
const notifyTargets = new Set(["NONE", "ADMIN", "SUPERADMIN", "ADMIN_AND_SUPERADMIN"]);

/** Priority alerts live in SuperAdmin Settings → System Settings (SuperAdmin only).
 *  Writes additionally require the given RBAC permission. */
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
  const triggers = await prisma.escalationTrigger.findMany({
    orderBy: { priority: "asc" },
  });
  return NextResponse.json(triggers);
}

export async function PATCH(req: Request) {
  const denied = await guardSuperAdmin("settings.update");
  if (denied) return denied;

  const body = await req.json();
  const priority = body.priority as TicketPriority;
  const enabled = Boolean(body.enabled);
  const notifyTarget = String(body.notifyTarget ?? "NONE").toUpperCase();

  if (!priorities.has(priority)) {
    return NextResponse.json({ error: "Invalid priority." }, { status: 400 });
  }
  if (!notifyTargets.has(notifyTarget)) {
    return NextResponse.json({ error: "Invalid notifyTarget." }, { status: 400 });
  }
  const notifyAdmin = notifyTarget === "ADMIN" || notifyTarget === "ADMIN_AND_SUPERADMIN";

  const trigger = await prisma.escalationTrigger.upsert({
    where: { priority },
    create: { priority, enabled, notifyAdmin, notifyTarget },
    update: { enabled, notifyAdmin, notifyTarget },
  });

  return NextResponse.json(trigger);
}
