import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/access";
import {
  canAccessRequestChat,
  loadTicketForChatAccess,
} from "@/lib/ticket-chat-access";
import { chatUploadDir, parseChatAttachments } from "@/lib/request-chat";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** GET /api/tickets/[id]/chat/files/[file] — serve a chat attachment. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; file: string }> },
) {
  const session = await requireSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, file } = await ctx.params;
  const storedFileName = path.basename(file);
  if (!storedFileName || storedFileName !== file) {
    return NextResponse.json({ error: "Invalid file." }, { status: 400 });
  }

  const ticket = await loadTicketForChatAccess(id);
  if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const allowed = await canAccessRequestChat({
    role: session.user.role,
    email: session.user.email,
    name: session.user.name,
    ticket,
  });
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const messages = await prisma.chatMessage.findMany({
    where: { ticketId: id },
    select: { attachments: true },
    take: 500,
    orderBy: { createdAt: "desc" },
  });
  let meta: { fileName: string; mimeType: string } | null = null;
  for (const row of messages) {
    const atts = parseChatAttachments(row.attachments);
    const hit = atts.find((a) => a.storedFileName === storedFileName);
    if (hit) {
      meta = { fileName: hit.fileName, mimeType: hit.mimeType };
      break;
    }
  }
  if (!meta) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const buf = await readFile(path.join(chatUploadDir(id), storedFileName));
    return new NextResponse(buf, {
      headers: {
        "Content-Type": meta.mimeType || "application/octet-stream",
        "Content-Disposition": `inline; filename="${meta.fileName.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "File missing." }, { status: 404 });
  }
}
