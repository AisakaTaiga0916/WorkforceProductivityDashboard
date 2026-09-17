import { Emitter } from "@socket.io/redis-emitter";
import IORedis from "ioredis";
import { resolveRedisUrl } from "@/lib/redis-connection";
import type { SerializedChatMessage } from "@/lib/request-chat-types";
import { requestChatRoom } from "@/lib/ticket-chat-access";

/**
 * Publish chat events from Next.js route handlers into Socket.IO rooms.
 * Uses a dedicated Redis connection; no-ops when Redis is unavailable.
 */

let emitter: Emitter | null = null;
let redis: IORedis | null = null;
let failed = false;

function getEmitter(): Emitter | null {
  if (failed) return null;
  if (emitter) return emitter;
  try {
    redis = new IORedis(resolveRedisUrl(), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 2_000,
      retryStrategy: () => null,
    });
    void redis.connect().catch(() => {
      failed = true;
      emitter = null;
      redis = null;
    });
    emitter = new Emitter(redis);
    return emitter;
  } catch {
    failed = true;
    emitter = null;
    redis = null;
    return null;
  }
}

export function emitRequestChatNewMessage(ticketId: string, message: SerializedChatMessage): void {
  const em = getEmitter();
  if (!em || !redis || redis.status !== "ready") return;
  try {
    em.to(requestChatRoom(ticketId)).emit("new-message", { ticketId, message });
  } catch {
    failed = true;
    emitter = null;
  }
}

export function emitRequestChatMessagesRead(
  ticketId: string,
  payload: { readerId: string; messageIds: string[]; readAt: string },
): void {
  const em = getEmitter();
  if (!em || !redis || redis.status !== "ready") return;
  try {
    em.to(requestChatRoom(ticketId)).emit("messages-read", { ticketId, ...payload });
  } catch {
    failed = true;
    emitter = null;
  }
}

export function emitRequestChatMessagesDelivered(
  ticketId: string,
  payload: { recipientId: string; messageIds: string[]; deliveredAt: string },
): void {
  const em = getEmitter();
  if (!em || !redis || redis.status !== "ready") return;
  try {
    em.to(requestChatRoom(ticketId)).emit("messages-delivered", { ticketId, ...payload });
  } catch {
    failed = true;
    emitter = null;
  }
}
