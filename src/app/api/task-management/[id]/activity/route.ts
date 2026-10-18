import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { resolveOpsPermissions } from "@/lib/ops-permissions";
import { prisma } from "@/modules/platform/db/prisma";

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { session, unauthorized } = await requireRole(["Admin", "Personnel"]);
  if (unauthorized || !session) return unauthorized;
  const { id } = await ctx.params;
  const task = await prisma.taskItem.findUnique({
    where: { id },
    select: { id: true, assignedAgentId: true },
  });
  if (!task) return NextResponse.json({ error: "Task not found." }, { status: 404 });
  const perms = await resolveOpsPermissions(session);
  const isAssignee = !!perms.operator && perms.operator.id === task.assignedAgentId;
  if (!(perms.canAssignWork || isAssignee)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const rows = await prisma.taskActivity.findMany({
    where: { taskId: id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ rows });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { session, unauthorized } = await requireRole(["Admin", "Personnel"]);
  if (unauthorized || !session) return unauthorized;
  const { id } = await ctx.params;
  const task = await prisma.taskItem.findUnique({
    where: { id },
    select: { id: true, assignedAgentId: true },
  });
  if (!task) return NextResponse.json({ error: "Task not found." }, { status: 404 });
  const perms = await resolveOpsPermissions(session);
  const isAssignee = !!perms.operator && perms.operator.id === task.assignedAgentId;
  if (!(perms.canAssignWork || isAssignee)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = (await req.json()) as { comment?: string };
  const comment = body.comment?.trim() ?? "";
  if (!comment) return NextResponse.json({ error: "comment is required." }, { status: 400 });
  const created = await prisma.taskActivity.create({
    data: {
      taskId: id,
      author: session.user.email ?? session.user.name ?? "unknown",
      action: "Comment added",
      detail: comment,
    },
  });
  return NextResponse.json(created, { status: 201 });
}
