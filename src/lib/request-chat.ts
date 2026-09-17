import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { isAllowedIntakeAttachment } from "@/lib/ticket-intake-screenshots-constants";
import {
  MAX_CHAT_ATTACHMENT_BYTES,
  MAX_CHAT_ATTACHMENTS_PER_MESSAGE,
  MAX_CHAT_BODY_LENGTH,
  resolveChatDeliveryStatus,
  type ChatAttachmentMeta,
  type SerializedChatMessage,
} from "@/lib/request-chat-types";
import { loadChatSenderAvatars } from "@/lib/ticket-chat-access";

export type { ChatAttachmentMeta, SerializedChatMessage } from "@/lib/request-chat-types";
export {
  MAX_CHAT_ATTACHMENT_BYTES,
  MAX_CHAT_ATTACHMENTS_PER_MESSAGE,
  MAX_CHAT_BODY_LENGTH,
  resolveChatDeliveryStatus,
} from "@/lib/request-chat-types";

/** Strip HTML / control chars; keep plain text (XSS-safe when rendered as text). */
export function sanitizeChatBody(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/\u0000/g, "")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/<[^>]*>/g, "")
    .trim()
    .slice(0, MAX_CHAT_BODY_LENGTH);
}

export function parseChatAttachments(raw: unknown): ChatAttachmentMeta[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatAttachmentMeta[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : "";
    const fileName = typeof r.fileName === "string" ? r.fileName : "";
    const mimeType = typeof r.mimeType === "string" ? r.mimeType : "application/octet-stream";
    const sizeBytes = typeof r.sizeBytes === "number" ? r.sizeBytes : Number(r.sizeBytes);
    const storedFileName = typeof r.storedFileName === "string" ? r.storedFileName : "";
    if (!id || !fileName || !storedFileName || !Number.isFinite(sizeBytes)) continue;
    out.push({ id, fileName, mimeType, sizeBytes, storedFileName });
  }
  return out;
}

export function serializeChatMessage(
  row: {
    id: string;
    ticketId: string;
    senderId: string;
    senderName: string;
    senderRole: string | null;
    body: string;
    attachments: unknown;
    isRead: boolean;
    readAt: Date | null;
    deliveredAt?: Date | null;
    createdAt: Date;
  },
  viewerId: string,
  avatar?: {
    profileImage: string | null;
    profileImageZoom: number;
    profileImagePosX: number;
    profileImagePosY: number;
  } | null,
): SerializedChatMessage {
  const deliveredAt = row.deliveredAt ?? null;
  const readAt = row.readAt ?? null;
  const deliveryStatus = resolveChatDeliveryStatus({
    isRead: row.isRead,
    readAt,
    deliveredAt,
  });
  const createdAt = row.createdAt.toISOString();
  return {
    id: row.id,
    ticketId: row.ticketId,
    senderId: row.senderId,
    senderName: row.senderName,
    senderRole: row.senderRole,
    body: row.body,
    attachments: parseChatAttachments(row.attachments),
    isRead: row.isRead,
    readAt: readAt?.toISOString() ?? null,
    createdAt,
    isMine: row.senderId === viewerId,
    deliveryStatus,
    sentAt: createdAt,
    deliveredAt: deliveredAt?.toISOString() ?? null,
    seenAt: readAt?.toISOString() ?? null,
    senderProfileImage: avatar?.profileImage ?? null,
    senderProfileImageZoom: avatar?.profileImageZoom ?? 1,
    senderProfileImagePosX: avatar?.profileImagePosX ?? 50,
    senderProfileImagePosY: avatar?.profileImagePosY ?? 50,
  };
}

export function chatUploadDir(ticketId: string): string {
  return path.join(process.cwd(), "uploads", "chat", ticketId);
}

export async function persistChatAttachments(
  ticketId: string,
  files: File[],
): Promise<ChatAttachmentMeta[]> {
  if (files.length === 0) return [];
  if (files.length > MAX_CHAT_ATTACHMENTS_PER_MESSAGE) {
    throw new Error(`At most ${MAX_CHAT_ATTACHMENTS_PER_MESSAGE} attachments per message.`);
  }
  const dir = chatUploadDir(ticketId);
  await mkdir(dir, { recursive: true });
  const saved: ChatAttachmentMeta[] = [];
  for (const file of files) {
    if (file.size <= 0) continue;
    if (file.size > MAX_CHAT_ATTACHMENT_BYTES) {
      throw new Error(`File "${file.name}" exceeds ${MAX_CHAT_ATTACHMENT_BYTES / (1024 * 1024)}MB.`);
    }
    const mimeType = file.type || "application/octet-stream";
    if (!isAllowedIntakeAttachment(mimeType, file.name)) {
      throw new Error(`File type not allowed: ${file.name}`);
    }
    const id = crypto.randomUUID();
    const safeBase = file.name.replace(/[^\w.\-()+ ]+/g, "_").slice(0, 80) || "file";
    const storedFileName = `${id}-${safeBase}`;
    const buf = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(dir, storedFileName), buf);
    saved.push({
      id,
      fileName: file.name.slice(0, 200),
      mimeType,
      sizeBytes: file.size,
      storedFileName,
    });
  }
  return saved;
}

export async function createChatMessage(args: {
  ticketId: string;
  senderId: string;
  senderName: string;
  senderRole?: string | null;
  body: string;
  attachments?: ChatAttachmentMeta[];
}) {
  const body = sanitizeChatBody(args.body);
  const attachments = args.attachments ?? [];
  if (!body && attachments.length === 0) {
    throw new Error("Message body or attachment is required.");
  }
  return prisma.chatMessage.create({
    data: {
      ticketId: args.ticketId,
      senderId: args.senderId,
      senderName: args.senderName.slice(0, 120),
      senderRole: args.senderRole?.slice(0, 40) ?? null,
      body: body || (attachments.length ? "(attachment)" : ""),
      attachments: attachments.length ? attachments : undefined,
    },
  });
}

/**
 * Mark messages as delivered when another participant receives them
 * (socket ack or history fetch). Does not change read/seen.
 */
export async function markChatMessagesDelivered(args: {
  ticketId: string;
  recipientId: string;
  messageIds?: string[];
}): Promise<{ marked: number; messageIds: string[]; deliveredAt: string }> {
  const now = new Date();
  const where =
    args.messageIds && args.messageIds.length > 0
      ? {
          ticketId: args.ticketId,
          id: { in: args.messageIds },
          senderId: { not: args.recipientId },
          deliveredAt: null,
        }
      : {
          ticketId: args.ticketId,
          senderId: { not: args.recipientId },
          deliveredAt: null,
        };

  const targets = await prisma.chatMessage.findMany({
    where,
    select: { id: true },
    take: 200,
  });
  if (targets.length === 0) {
    return { marked: 0, messageIds: [], deliveredAt: now.toISOString() };
  }

  const ids = targets.map((t) => t.id);
  await prisma.chatMessage.updateMany({
    where: { id: { in: ids }, deliveredAt: null },
    data: { deliveredAt: now },
  });
  return { marked: ids.length, messageIds: ids, deliveredAt: now.toISOString() };
}

export async function listChatMessages(args: {
  ticketId: string;
  viewerId: string;
  /** Fetch messages older than this cursor (exclusive). */
  before?: string | null;
  limit?: number;
  /** When true (default), viewing another's messages counts as delivery. */
  markDelivered?: boolean;
}): Promise<{
  messages: SerializedChatMessage[];
  hasMore: boolean;
  newlyDelivered?: { messageIds: string[]; deliveredAt: string };
}> {
  const limit = Math.min(Math.max(args.limit ?? 30, 1), 100);
  const before = args.before?.trim() || null;
  let beforeDate: Date | null = null;
  if (before) {
    const anchor = await prisma.chatMessage.findFirst({
      where: { id: before, ticketId: args.ticketId },
      select: { createdAt: true },
    });
    beforeDate = anchor?.createdAt ?? null;
  }

  const rows = await prisma.chatMessage.findMany({
    where: {
      ticketId: args.ticketId,
      ...(beforeDate ? { createdAt: { lt: beforeDate } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  // Return oldest → newest for UI
  const chronological = slice.reverse();

  let newlyDelivered: { messageIds: string[]; deliveredAt: string } | undefined;
  if (args.markDelivered !== false) {
    const undeliveredIds = chronological
      .filter((r) => r.senderId !== args.viewerId && !r.deliveredAt)
      .map((r) => r.id);
    if (undeliveredIds.length > 0) {
      const result = await markChatMessagesDelivered({
        ticketId: args.ticketId,
        recipientId: args.viewerId,
        messageIds: undeliveredIds,
      });
      if (result.marked > 0) {
        newlyDelivered = {
          messageIds: result.messageIds,
          deliveredAt: result.deliveredAt,
        };
        const deliveredAtDate = new Date(result.deliveredAt);
        for (const row of chronological) {
          if (result.messageIds.includes(row.id)) {
            row.deliveredAt = deliveredAtDate;
          }
        }
      }
    }
  }

  const avatars = await loadChatSenderAvatars(chronological.map((r) => r.senderId));
  return {
    messages: chronological.map((row) =>
      serializeChatMessage(row, args.viewerId, avatars.get(row.senderId) ?? null),
    ),
    hasMore,
    newlyDelivered,
  };
}

export async function markChatMessagesRead(args: {
  ticketId: string;
  readerId: string;
  messageIds?: string[];
}): Promise<{ marked: number }> {
  const where =
    args.messageIds && args.messageIds.length > 0
      ? {
          ticketId: args.ticketId,
          id: { in: args.messageIds },
          senderId: { not: args.readerId },
        }
      : {
          ticketId: args.ticketId,
          senderId: { not: args.readerId },
          isRead: false,
        };

  const targets = await prisma.chatMessage.findMany({
    where,
    select: { id: true, deliveredAt: true },
    take: 200,
  });
  if (targets.length === 0) return { marked: 0 };

  const now = new Date();
  const ids = targets.map((t) => t.id);
  await prisma.$transaction([
    ...targets.map((t) =>
      prisma.chatMessageRead.upsert({
        where: {
          messageId_readerId: { messageId: t.id, readerId: args.readerId },
        },
        create: { messageId: t.id, readerId: args.readerId, readAt: now },
        update: { readAt: now },
      }),
    ),
    prisma.chatMessage.updateMany({
      where: { id: { in: ids }, isRead: false },
      data: { isRead: true, readAt: now },
    }),
    // Seeing a message implies it was delivered.
    prisma.chatMessage.updateMany({
      where: { id: { in: ids }, deliveredAt: null },
      data: { deliveredAt: now },
    }),
  ]);
  return { marked: targets.length };
}
