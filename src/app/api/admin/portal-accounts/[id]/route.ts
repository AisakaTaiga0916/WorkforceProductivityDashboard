import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { permissionDenied } from "@/modules/platform/rbac/permissions";
import { prisma } from "@/modules/platform/db/prisma";

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { session, unauthorized } = await requireRole(["SuperAdmin"]);
  if (unauthorized || !session) return unauthorized;
  const denied = await permissionDenied(session, "users.delete");
  if (denied) return denied;

  const { id } = await ctx.params;

  const portal = await prisma.portalAccount.findUnique({
    where: { id },
    select: { id: true, email: true },
  });
  if (!portal) {
    return NextResponse.json({ error: "Portal account not found." }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    const agents = await tx.agent.findMany({
      where: { email: { equals: portal.email, mode: "insensitive" } },
      select: { id: true },
    });
    const agentIds = agents.map((a) => a.id);

    if (agentIds.length > 0) {
      await tx.ticket.updateMany({
        where: { assignedAgentId: { in: agentIds } },
        data: { assignedAgentId: null },
      });
      await tx.kpiMaintenance.updateMany({
        where: { assignedAgentId: { in: agentIds } },
        data: { assignedAgentId: null, assignedRole: null },
      });
      await tx.taskItem.updateMany({
        where: { assignedAgentId: { in: agentIds } },
        data: { assignedAgentId: null },
      });
      await tx.agent.deleteMany({
        where: { id: { in: agentIds } },
      });
    }

    await tx.accountActionRequest.deleteMany({
      where: { portalAccountId: portal.id },
    });

    await tx.portalAccount.delete({
      where: { id: portal.id },
    });
  });

  return NextResponse.json({ ok: true });
}
