import { Prisma } from "@prisma/client/primary";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { permissionDenied } from "@/modules/platform/rbac/permissions";
import { prisma } from "@/modules/platform/db/prisma";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { session, unauthorized } = await requireRole(["Admin"]);
  if (unauthorized || !session) return unauthorized;
  const denied = await permissionDenied(session, "users.update");
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = (await req.json()) as { teamId?: string };

  const teamId = body.teamId?.trim() ?? "";
  if (!teamId) {
    return NextResponse.json({ error: "teamId is required." }, { status: 400 });
  }

  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) {
    return NextResponse.json({ error: "Invalid team." }, { status: 400 });
  }

  const data: Prisma.AgentUpdateInput = {
    team: { connect: { id: teamId } },
  };

  try {
    const updated = await prisma.agent.update({
      where: { id },
      data,
      include: { team: true },
    });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Could not update personnel." }, { status: 404 });
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { session, unauthorized } = await requireRole(["Admin"]);
  if (unauthorized || !session) return unauthorized;
  const denied = await permissionDenied(session, "users.update");
  if (denied) return denied;
  const { id } = await ctx.params;

  const agent = await prisma.agent.findUnique({
    where: { id },
    select: { id: true, email: true },
  });
  if (!agent) {
    return NextResponse.json({ error: "Personnel roster entry not found." }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.portalAccount.updateMany({
      where: { email: { equals: agent.email, mode: "insensitive" } },
      data: {
        staffDesignatedCompanyId: null,
        staffAssignmentColor: null,
      },
    });
    await tx.ticket.updateMany({
      where: { assignedAgentId: agent.id },
      data: { assignedAgentId: null },
    });
    await tx.kpiMaintenance.updateMany({
      where: { assignedAgentId: agent.id },
      data: { assignedAgentId: null, assignedRole: null },
    });
    await tx.taskItem.updateMany({
      where: { assignedAgentId: agent.id },
      data: { assignedAgentId: null },
    });
    await tx.agent.delete({ where: { id: agent.id } });
  });

  return NextResponse.json({ ok: true });
}
