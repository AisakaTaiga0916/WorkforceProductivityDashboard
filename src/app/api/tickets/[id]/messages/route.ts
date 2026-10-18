import type { ActivityActor } from "@prisma/client/primary";
import { NextResponse } from "next/server";
import { customerCanAccessTicket, ensureTicketOwnership, requireSession } from "@/lib/access";
import { moduleDisabledResponse } from "@/modules/platform/settings/system-modules-db";
import { prisma } from "@/modules/platform/db/prisma";
import { findSessionAgentId } from "@/lib/session-agent";
import { logActivity, touchFirstResponse } from "@/modules/requests/ticket-actions";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "Customer") {
    const moduleOff = await moduleDisabledResponse("requests");
    if (moduleOff) return moduleOff;
  }

  const { id } = await ctx.params;
  const ticket = await prisma.ticket.findUnique({ where: { id } });
  if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const isOwner =
    session.user.role === "Customer"
      ? customerCanAccessTicket(
          { contactEmail: ticket.contactEmail, requestorEmail: ticket.requestorEmail },
          session.user.email,
        )
      : ensureTicketOwnership(ticket.contactEmail, session.user.email);
  const isAdminOrAgent = ["SuperAdmin", "HighAdmin", "Admin", "Personnel"].includes(session.user.role);
  if (session.user.role === "Personnel") {
    const operator = await findSessionAgentId({ email: session.user.email, name: session.user.name });
    if (!operator || operator.id !== ticket.assignedAgentId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const body = await req.json();
  const actor = body.actor as ActivityActor;
  const author =
    (body.author as string | undefined) ??
    session.user.name ??
    session.user.email ??
    "User";
  const text = body.body as string;

  if (!author || !text || !["USER", "AGENT", "SYSTEM"].includes(actor)) {
    return NextResponse.json({ error: "Invalid message payload" }, { status: 400 });
  }
  if (actor === "AGENT" && !isAdminOrAgent) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (actor === "USER" && !isOwner && !["SuperAdmin", "HighAdmin", "Admin"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (actor === "SYSTEM" && !["SuperAdmin", "HighAdmin", "Admin"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const msg = await prisma.ticketMessage.create({
    data: { ticketId: id, actor, author, body: text },
  });

  if (actor === "AGENT") {
    await touchFirstResponse(ticket, "AGENT");
  }

  await logActivity(
    id,
    actor,
    actor === "AGENT" ? "Agent update" : "Customer update",
    text.slice(0, 280),
  );

  return NextResponse.json(msg, { status: 201 });
}
