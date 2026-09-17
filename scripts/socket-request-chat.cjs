/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Socket.IO request-chat handlers for server.js.
 * Auth via NextAuth JWT cookie; rooms: request:{ticketId}.
 * Access checks go through the Next chat API so ACL stays in one place.
 */
const { getToken } = require("next-auth/jwt");

function roomName(ticketId) {
  return `request:${String(ticketId || "").trim()}`;
}

function sanitizeBody(raw) {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/\u0000/g, "")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/<[^>]*>/g, "")
    .trim()
    .slice(0, 4000);
}

/**
 * @param {import('socket.io').Server} io
 * @param {import('@prisma/client/primary').PrismaClient} prisma
 * @param {{ jobHost: string, port: number }} opts
 */
function attachRequestChatHandlers(io, prisma, opts) {
  const jobHost = opts.jobHost || "127.0.0.1";
  const port = opts.port || 3000;

  io.use(async (socket, next) => {
    try {
      const token = await getToken({
        req: socket.request,
        secret: process.env.NEXTAUTH_SECRET,
      });
      if (!token?.sub && !token?.email) {
        return next(new Error("unauthorized"));
      }
      socket.data.user = {
        id: String(token.sub || token.id || token.email || ""),
        email: typeof token.email === "string" ? token.email : null,
        name: typeof token.name === "string" ? token.name : null,
        role: typeof token.role === "string" ? token.role : "Customer",
      };
      if (!socket.data.user.id) return next(new Error("unauthorized"));
      return next();
    } catch (err) {
      return next(err instanceof Error ? err : new Error("unauthorized"));
    }
  });

  async function canAccessTicket(socket, ticketId) {
    const cookie = socket.request.headers.cookie || "";
    try {
      const res = await fetch(
        `http://${jobHost}:${port}/api/tickets/${encodeURIComponent(ticketId)}/chat?limit=1`,
        {
          method: "GET",
          headers: cookie ? { cookie } : {},
        },
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  io.on("connection", (socket) => {
    socket.emit("connected", { ok: true, at: new Date().toISOString() });

    socket.on("join-request-chat", async (payload, ack) => {
      const ticketId = String(payload?.ticketId || payload?.requestId || "").trim();
      const respond = typeof ack === "function" ? ack : () => {};
      if (!ticketId) {
        respond({ ok: false, error: "ticketId required" });
        return;
      }
      try {
        const allowed = await canAccessTicket(socket, ticketId);
        if (!allowed) {
          respond({ ok: false, error: "forbidden" });
          return;
        }
        await socket.join(roomName(ticketId));
        respond({ ok: true, room: roomName(ticketId) });
      } catch (e) {
        respond({ ok: false, error: e instanceof Error ? e.message : "join failed" });
      }
    });

    socket.on("leave-request-chat", async (payload, ack) => {
      const ticketId = String(payload?.ticketId || payload?.requestId || "").trim();
      const respond = typeof ack === "function" ? ack : () => {};
      if (ticketId) await socket.leave(roomName(ticketId));
      respond({ ok: true });
    });

    socket.on("send-message", async (payload, ack) => {
      const ticketId = String(payload?.ticketId || payload?.requestId || "").trim();
      const body = sanitizeBody(payload?.body);
      const attachments = Array.isArray(payload?.attachments) ? payload.attachments : [];
      const respond = typeof ack === "function" ? ack : () => {};
      if (!ticketId) {
        respond({ ok: false, error: "ticketId required" });
        return;
      }
      if (!body && attachments.length === 0) {
        respond({ ok: false, error: "empty message" });
        return;
      }
      try {
        const allowed = await canAccessTicket(socket, ticketId);
        if (!allowed) {
          respond({ ok: false, error: "forbidden" });
          return;
        }
        const ticketRow = await prisma.ticket.findUnique({
          where: { id: ticketId },
          select: { status: true },
        });
        if (ticketRow?.status === "CLOSED") {
          respond({ ok: false, error: "Request chat is closed because this request is closed." });
          return;
        }
        if (!socket.rooms.has(roomName(ticketId))) {
          await socket.join(roomName(ticketId));
        }
        const user = socket.data.user;
        const row = await prisma.chatMessage.create({
          data: {
            ticketId,
            senderId: user.id,
            senderName: (user.name || user.email || "User").slice(0, 120),
            senderRole: user.role || null,
            body: body || (attachments.length ? "(attachment)" : ""),
            attachments: attachments.length ? attachments : undefined,
          },
        });
        let avatar = {
          senderProfileImage: null,
          senderProfileImageZoom: 1,
          senderProfileImagePosX: 50,
          senderProfileImagePosY: 50,
        };
        try {
          const portal = await prisma.portalAccount.findUnique({
            where: { id: user.id },
            select: {
              profileImage: true,
              profileImageZoom: true,
              profileImagePosX: true,
              profileImagePosY: true,
            },
          });
          if (portal) {
            avatar = {
              senderProfileImage: portal.profileImage,
              senderProfileImageZoom: portal.profileImageZoom ?? 1,
              senderProfileImagePosX: portal.profileImagePosX ?? 50,
              senderProfileImagePosY: portal.profileImagePosY ?? 50,
            };
          }
        } catch {
          // Avatar is optional; message still delivers.
        }
        const createdAt = row.createdAt.toISOString();
        const base = {
          id: row.id,
          ticketId: row.ticketId,
          senderId: row.senderId,
          senderName: row.senderName,
          senderRole: row.senderRole,
          body: row.body,
          attachments,
          isRead: false,
          readAt: null,
          createdAt,
          deliveryStatus: "sent",
          sentAt: createdAt,
          deliveredAt: null,
          seenAt: null,
          ...avatar,
        };
        socket.to(roomName(ticketId)).emit("new-message", {
          ticketId,
          message: { ...base, isMine: false },
        });
        // Also emit to sender so multi-tab UIs stay in sync with isMine computed client-side.
        socket.emit("new-message", { ticketId, message: { ...base, isMine: true } });
        respond({ ok: true, message: { ...base, isMine: true } });
      } catch (e) {
        respond({ ok: false, error: e instanceof Error ? e.message : "send failed" });
      }
    });

    socket.on("typing", (payload) => {
      const ticketId = String(payload?.ticketId || payload?.requestId || "").trim();
      if (!ticketId || !socket.rooms.has(roomName(ticketId))) return;
      socket.to(roomName(ticketId)).emit("typing", {
        ticketId,
        userId: socket.data.user.id,
        userName: socket.data.user.name || socket.data.user.email || "User",
      });
    });

    socket.on("stop-typing", (payload) => {
      const ticketId = String(payload?.ticketId || payload?.requestId || "").trim();
      if (!ticketId || !socket.rooms.has(roomName(ticketId))) return;
      socket.to(roomName(ticketId)).emit("stop-typing", {
        ticketId,
        userId: socket.data.user.id,
      });
    });

    socket.on("messages-read", async (payload, ack) => {
      const ticketId = String(payload?.ticketId || payload?.requestId || "").trim();
      const messageIds = Array.isArray(payload?.messageIds)
        ? payload.messageIds.map((id) => String(id)).filter(Boolean)
        : [];
      const respond = typeof ack === "function" ? ack : () => {};
      if (!ticketId) {
        respond({ ok: false, error: "ticketId required" });
        return;
      }
      try {
        const allowed = await canAccessTicket(socket, ticketId);
        if (!allowed) {
          respond({ ok: false, error: "forbidden" });
          return;
        }
        const readerId = socket.data.user.id;
        const where =
          messageIds.length > 0
            ? { ticketId, id: { in: messageIds }, senderId: { not: readerId } }
            : { ticketId, senderId: { not: readerId }, isRead: false };
        const targets = await prisma.chatMessage.findMany({
          where,
          select: { id: true },
          take: 200,
        });
        const now = new Date();
        if (targets.length > 0) {
          const ids = targets.map((t) => t.id);
          await prisma.$transaction([
            ...targets.map((t) =>
              prisma.chatMessageRead.upsert({
                where: { messageId_readerId: { messageId: t.id, readerId } },
                create: { messageId: t.id, readerId, readAt: now },
                update: { readAt: now },
              }),
            ),
            prisma.chatMessage.updateMany({
              where: { id: { in: ids }, isRead: false },
              data: { isRead: true, readAt: now },
            }),
            prisma.chatMessage.updateMany({
              where: { id: { in: ids }, deliveredAt: null },
              data: { deliveredAt: now },
            }),
          ]);
        }
        const event = {
          ticketId,
          readerId,
          messageIds: targets.map((t) => t.id),
          readAt: now.toISOString(),
        };
        io.to(roomName(ticketId)).emit("messages-read", event);
        respond({ ok: true, ...event });
      } catch (e) {
        respond({ ok: false, error: e instanceof Error ? e.message : "read failed" });
      }
    });

    socket.on("messages-delivered", async (payload, ack) => {
      const ticketId = String(payload?.ticketId || payload?.requestId || "").trim();
      const messageIds = Array.isArray(payload?.messageIds)
        ? payload.messageIds.map((id) => String(id)).filter(Boolean)
        : [];
      const respond = typeof ack === "function" ? ack : () => {};
      if (!ticketId || messageIds.length === 0) {
        respond({ ok: false, error: "ticketId and messageIds required" });
        return;
      }
      try {
        const allowed = await canAccessTicket(socket, ticketId);
        if (!allowed) {
          respond({ ok: false, error: "forbidden" });
          return;
        }
        const recipientId = socket.data.user.id;
        const now = new Date();
        const result = await prisma.chatMessage.updateMany({
          where: {
            ticketId,
            id: { in: messageIds },
            senderId: { not: recipientId },
            deliveredAt: null,
          },
          data: { deliveredAt: now },
        });
        const event = {
          ticketId,
          recipientId,
          messageIds,
          deliveredAt: now.toISOString(),
        };
        if (result.count > 0) {
          io.to(roomName(ticketId)).emit("messages-delivered", event);
        }
        respond({ ok: true, marked: result.count, ...event });
      } catch (e) {
        respond({ ok: false, error: e instanceof Error ? e.message : "deliver failed" });
      }
    });
  });
}

module.exports = { attachRequestChatHandlers, roomName };
