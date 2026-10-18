import { NextResponse } from "next/server";
import {
  agentMatchesPortalStaff,
  pickCanonicalAgentForPortal,
} from "@/lib/admin-roster";
import { requireRole } from "@/lib/access";
import { permissionDenied } from "@/modules/platform/rbac/permissions";
import { prisma } from "@/modules/platform/db/prisma";
import { isStaffPortalRole } from "@/lib/staff-role";

/**
 * Merges duplicate Agent rows that map to the same staff portal identity (email + name matching).
 * Keeps the canonical agent (portal email match, else oldest), reassigns tickets/tasks/KPIs, deletes extras.
 */
export async function POST() {
  const { session, unauthorized } = await requireRole(["Admin"]);
  if (unauthorized || !session) return unauthorized;

  const denied = await permissionDenied(session, "users.update");
  if (denied) return denied;

  let agents = await prisma.agent.findMany({ orderBy: { createdAt: "asc" } });
  const portalStaff = await prisma.portalAccount.findMany({
    select: { id: true, email: true, name: true, role: true },
  });

  const staffPortals = portalStaff.filter((p) => isStaffPortalRole(p.role));

  let merged = 0;
  const deletedIds: string[] = [];
  const removed = new Set<string>();

  for (const portal of staffPortals) {
    const matching = agents.filter(
      (a) => !removed.has(a.id) && agentMatchesPortalStaff(portal, a),
    );
    if (matching.length <= 1) continue;

    const canonical = pickCanonicalAgentForPortal(portal, matching);
    if (!canonical) continue;

    const duplicates = matching.filter((a) => a.id !== canonical.id);
    for (const dup of duplicates) {
      await prisma.$transaction([
        prisma.ticket.updateMany({
          where: { assignedAgentId: dup.id },
          data: { assignedAgentId: canonical.id },
        }),
        prisma.taskItem.updateMany({
          where: { assignedAgentId: dup.id },
          data: { assignedAgentId: canonical.id },
        }),
        prisma.kpiMaintenance.updateMany({
          where: { assignedAgentId: dup.id },
          data: { assignedAgentId: canonical.id },
        }),
        prisma.agent.delete({ where: { id: dup.id } }),
      ]);
      removed.add(dup.id);
      merged += 1;
      deletedIds.push(dup.id);
    }

    agents = agents.filter((a) => !removed.has(a.id));
  }

  return NextResponse.json({
    ok: true,
    mergedAgentRows: merged,
    deletedAgentIds: deletedIds,
  });
}
