import { NextResponse } from "next/server";
import { requireSession } from "@/lib/access";
import {
  canAccessRequestChat,
  isRequestChatClosed,
  loadChatSenderAvatars,
  loadTicketForChatAccess,
  resolveRequestChatParticipants,
} from "@/lib/ticket-chat-access";
import {
  createChatMessage,
  listChatMessages,
  markChatMessagesRead,
  persistChatAttachments,
  sanitizeChatBody,
  serializeChatMessage,
  type ChatAttachmentMeta,
} from "@/lib/request-chat";
import { emitRequestChatMessagesDelivered, emitRequestChatMessagesRead, emitRequestChatNewMessage } from "@/lib/request-chat-emit";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

async function guardChatAccess(ticketId: string) {
  const session = await requireSession();
  if (!session?.user) {
    return {
      session: null as null,
      unauthorized: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const ticket = await loadTicketForChatAccess(ticketId);
  if (!ticket) {
    return {
      session,
      unauthorized: NextResponse.json({ error: "Not found" }, { status: 404 }),
    };
  }
  const allowed = await canAccessRequestChat({
    role: session.user.role,
    email: session.user.email,
    name: session.user.name,
    ticket,
  });
  if (!allowed) {
    return {
      session,
      unauthorized: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { session, unauthorized: null as null, ticket };
}

/** GET /api/tickets/[id]/chat?before=&limit= — paginated history (oldest→newest in page). */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const gate = await guardChatAccess(id);
  if (gate.unauthorized || !gate.session?.user || !gate.ticket) return gate.unauthorized!;

  const { searchParams } = new URL(req.url);
  const before = searchParams.get("before");
  const limitRaw = Number.parseInt(String(searchParams.get("limit") ?? "30"), 10);
  const limit = Number.isFinite(limitRaw) ? limitRaw : 30;

  const viewerId = String(gate.session.user.id || gate.session.user.email || "");
  const [result, participants] = await Promise.all([
    listChatMessages({
      ticketId: id,
      viewerId,
      before,
      limit,
    }),
    // Only resolve the header stack on the first page (no `before` cursor).
    before ? Promise.resolve(undefined) : resolveRequestChatParticipants(gate.ticket),
  ]);

  if (result.newlyDelivered && result.newlyDelivered.messageIds.length > 0) {
    emitRequestChatMessagesDelivered(id, {
      recipientId: viewerId,
      messageIds: result.newlyDelivered.messageIds,
      deliveredAt: result.newlyDelivered.deliveredAt,
    });
  }

  return NextResponse.json(
    {
      messages: result.messages,
      hasMore: result.hasMore,
      chatClosed: isRequestChatClosed(gate.ticket),
      ...(participants ? { participants } : {}),
    },
    {
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}

/**
 * POST /api/tickets/[id]/chat
 * JSON: { body, attachments? }
 * multipart: body + files[]
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const gate = await guardChatAccess(id);
  if (gate.unauthorized || !gate.session?.user || !gate.ticket) return gate.unauthorized!;

  if (isRequestChatClosed(gate.ticket)) {
    return NextResponse.json(
      { error: "Request chat is closed because this request is closed." },
      { status: 403 },
    );
  }

  const lim = await rateLimit({
    key: `chat-send:${(gate.session.user.email ?? "").trim().toLowerCase() || clientIp(req)}`,
    limit: 60,
    windowSeconds: 60,
  });
  if (!lim.allowed) {
    return NextResponse.json(
      { error: "Too many chat messages. Please wait.", retryAfterSec: lim.retryAfterSec },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.max(1, lim.retryAfterSec)),
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const viewerId = String(gate.session.user.id || gate.session.user.email || "");
  const senderName =
    gate.session.user.name?.trim() ||
    gate.session.user.email?.trim() ||
    "User";

  let body = "";
  let attachments: ChatAttachmentMeta[] = [];

  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      body = sanitizeChatBody(form.get("body"));
      const files = form
        .getAll("files")
        .filter((f): f is File => typeof File !== "undefined" && f instanceof File);
      attachments = await persistChatAttachments(id, files);
    } else {
      const json = (await req.json().catch(() => ({}))) as {
        body?: string;
        attachments?: ChatAttachmentMeta[];
      };
      body = sanitizeChatBody(json.body);
      if (Array.isArray(json.attachments)) {
        attachments = json.attachments.filter(
          (a) => a && typeof a.storedFileName === "string" && typeof a.fileName === "string",
        );
      }
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid chat payload." },
      { status: 400 },
    );
  }

  try {
    const row = await createChatMessage({
      ticketId: id,
      senderId: viewerId,
      senderName,
      senderRole: gate.session.user.role,
      body,
      attachments,
    });
    const avatars = await loadChatSenderAvatars([viewerId]);
    const message = serializeChatMessage(row, viewerId, avatars.get(viewerId) ?? null);
    emitRequestChatNewMessage(id, { ...message, isMine: false });
    return NextResponse.json({ message }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not send message." },
      { status: 400 },
    );
  }
}

/** PATCH /api/tickets/[id]/chat — mark messages read. Body: { messageIds?: string[] } */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const gate = await guardChatAccess(id);
  if (gate.unauthorized || !gate.session?.user) return gate.unauthorized!;

  const viewerId = String(gate.session.user.id || gate.session.user.email || "");
  const json = (await req.json().catch(() => ({}))) as { messageIds?: string[] };
  const result = await markChatMessagesRead({
    ticketId: id,
    readerId: viewerId,
    messageIds: json.messageIds,
  });
  const readAt = new Date().toISOString();
  emitRequestChatMessagesRead(id, {
    readerId: viewerId,
    messageIds: json.messageIds ?? [],
    readAt,
  });
  return NextResponse.json({ ...result, readAt });
}
