import { isElevatedUserRole } from "@/modules/platform/auth";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/access";
import {
  getEffectiveAccess,
  permissionSubjectFromSession,
} from "@/modules/platform/rbac/permissions";
import { findSessionAgentWithTeam } from "@/lib/session-agent";

export async function GET() {
  const session = await requireSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = session.user.role;
  const operator = await findSessionAgentWithTeam({ email: session.user.email, name: session.user.name });

  /** Assignment board is SuperAdmin / Admin only; Personnel use request-approval on tickets. */
  const canAccessAssignmentBoard = isElevatedUserRole(role) || role === "Admin";

  /** RBAC: fail-closed server-side; the UI uses these to hide actions it cannot run. */
  const access = await getEffectiveAccess(permissionSubjectFromSession(session));

  return NextResponse.json({
    canAccessAssignmentBoard,
    operatorAgentId: operator?.id ?? null,
    operatorAgentName: operator?.name ?? null,
    role: access.role ? { key: access.role.key, name: access.role.name } : null,
    permissions: [...access.permissions].sort(),
  });
}
