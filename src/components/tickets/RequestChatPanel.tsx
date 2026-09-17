"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { Check, CheckCheck, ChevronDown, ChevronUp, Paperclip, Send } from "lucide-react";
import { getRealtimeSocket } from "@/lib/realtime-client";
import { INTAKE_ATTACHMENT_ACCEPT } from "@/lib/ticket-intake-screenshots-constants";
import { cn } from "@/lib/cn";
import type {
  ChatDeliveryStatus,
  ChatParticipant,
  SerializedChatMessage,
} from "@/lib/request-chat-types";
import { resolveChatDeliveryStatus } from "@/lib/request-chat-types";

type Props = {
  /** Ticket / request id */
  requestId: string;
  /** When true, history stays readable but sending is disabled. */
  closed?: boolean;
  /** Optional entity label for future reuse */
  entityLabel?: string;
  className?: string;
  defaultOpen?: boolean;
};

type AvatarFields = {
  name: string;
  profileImage?: string | null;
  profileImageZoom?: number | null;
  profileImagePosX?: number | null;
  profileImagePosY?: number | null;
};

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function deliveryMeta(m: SerializedChatMessage): {
  status: ChatDeliveryStatus;
  label: string;
  at: string;
} {
  const status =
    m.deliveryStatus ??
    resolveChatDeliveryStatus({
      isRead: m.isRead,
      readAt: m.readAt,
      deliveredAt: m.deliveredAt,
    });
  if (status === "seen") {
    return { status, label: "Seen", at: m.seenAt || m.readAt || m.deliveredAt || m.sentAt || m.createdAt };
  }
  if (status === "delivered") {
    return { status, label: "Delivered", at: m.deliveredAt || m.sentAt || m.createdAt };
  }
  return { status, label: "Sent", at: m.sentAt || m.createdAt };
}

function MessageDeliveryFooter({ message }: { message: SerializedChatMessage }) {
  const meta = deliveryMeta(message);
  const Icon = meta.status === "sent" ? Check : CheckCheck;
  return (
    <p
      className={cn(
        "flex items-center gap-1 px-1 text-[10px]",
        message.isMine ? "justify-end text-zinc-500" : "justify-start text-zinc-500",
      )}
      title={
        message.isMine
          ? `${meta.label} · ${formatTime(meta.at)}`
          : formatTime(message.createdAt)
      }
    >
      {message.isMine ? (
        <>
          <Icon
            className={cn(
              "size-3.5 shrink-0",
              meta.status === "seen"
                ? "text-sky-500 dark:text-sky-400"
                : meta.status === "delivered"
                  ? "text-zinc-500"
                  : "text-zinc-400",
            )}
            aria-hidden
          />
          <span
            className={cn(
              meta.status === "seen" && "text-sky-600 dark:text-sky-400",
            )}
          >
            {meta.label}
          </span>
          <span aria-hidden>·</span>
        </>
      ) : null}
      <span>{formatTime(meta.status === "sent" || !message.isMine ? message.createdAt : meta.at)}</span>
    </p>
  );
}

function TypingDotsBubble({ name }: { name: string }) {
  return (
    <div className="flex gap-2" aria-live="polite" aria-label={`${name} is typing`}>
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-[10px] font-bold text-zinc-600 ring-2 ring-white dark:bg-zinc-700 dark:text-zinc-200 dark:ring-zinc-900">
        …
      </div>
      <div className="rounded-2xl bg-zinc-100 px-3 py-2.5 dark:bg-zinc-800">
        <div className="flex items-center gap-1">
          <span className="size-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.3s] dark:bg-zinc-500" />
          <span className="size-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.15s] dark:bg-zinc-500" />
          <span className="size-1.5 animate-bounce rounded-full bg-zinc-400 dark:bg-zinc-500" />
        </div>
      </div>
    </div>
  );
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
  }
  return (name.trim().slice(0, 2) || "?").toUpperCase();
}

function ChatAvatar({
  person,
  className,
  title,
}: {
  person: AvatarFields;
  className?: string;
  title?: string;
}) {
  const label = title || person.name;
  const [imgFailed, setImgFailed] = useState(false);
  if (person.profileImage && !imgFailed) {
    return (
      <div
        title={label}
        className={cn(
          "shrink-0 overflow-hidden rounded-full bg-zinc-200 ring-2 ring-white dark:bg-zinc-800 dark:ring-zinc-900",
          className ?? "size-7",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={person.profileImage}
          alt={person.name}
          className="h-full w-full object-cover"
          onError={() => setImgFailed(true)}
          style={{
            objectPosition: `${person.profileImagePosX ?? 50}% ${person.profileImagePosY ?? 50}%`,
            transform: `scale(${person.profileImageZoom ?? 1})`,
            transformOrigin: "center",
          }}
        />
      </div>
    );
  }
  return (
    <div
      title={label}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-orange-700 text-[10px] font-bold text-white ring-2 ring-white dark:ring-zinc-900",
        className ?? "size-7",
      )}
    >
      {initialsFromName(person.name)}
    </div>
  );
}

function ParticipantStack({ participants }: { participants: ChatParticipant[] }) {
  const maxVisible = 4;
  const visible = participants.slice(0, maxVisible);
  const overflow = participants.length - visible.length;
  if (visible.length === 0) return null;

  return (
    <div className="flex items-center" aria-label="Chat participants">
      <div className="flex items-center -space-x-2">
        {visible.map((p, index) => (
          <div
            key={p.key}
            className="relative"
            style={{ zIndex: visible.length - index }}
          >
            <ChatAvatar
              person={p}
              className="size-7"
              title={`${p.name} · ${p.role}`}
            />
          </div>
        ))}
        {overflow > 0 ? (
          <div
            className="relative z-0 flex size-7 items-center justify-center rounded-full bg-zinc-700 text-[10px] font-bold text-white ring-2 ring-white dark:ring-zinc-900"
            title={`${overflow} more`}
          >
            +{overflow}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function avatarFromMessage(m: SerializedChatMessage): AvatarFields {
  return {
    name: m.senderName,
    profileImage: m.senderProfileImage,
    profileImageZoom: m.senderProfileImageZoom,
    profileImagePosX: m.senderProfileImagePosX,
    profileImagePosY: m.senderProfileImagePosY,
  };
}

export function RequestChatPanel({
  requestId,
  closed: closedProp = false,
  entityLabel = "Request chat",
  className,
  defaultOpen = true,
}: Props) {
  const { data: session } = useSession();
  const viewerId = String(session?.user?.id || session?.user?.email || "");
  const [open, setOpen] = useState(defaultOpen);
  const [messages, setMessages] = useState<SerializedChatMessage[]>([]);
  const [participants, setParticipants] = useState<ChatParticipant[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [typingName, setTypingName] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [socketTried, setSocketTried] = useState(false);
  const [chatClosedFromApi, setChatClosedFromApi] = useState(false);
  const chatClosed = closedProp || chatClosedFromApi;
  const listRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stickToBottom = useRef(true);
  const lastScrollMessageId = useRef<string | null>(null);

  /** Scroll only the chat list — never use scrollIntoView (it moves the page). */
  const scrollListToBottom = useCallback((smooth = false) => {
    const el = listRef.current;
    if (!el) return;
    if (smooth) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  const avatarBySenderId = useMemo(() => {
    const map = new Map<string, AvatarFields>();
    for (const p of participants) {
      if (p.portalAccountId) {
        map.set(p.portalAccountId, p);
      }
    }
    for (const m of messages) {
      if (!m.senderId) continue;
      const existing = map.get(m.senderId);
      if (m.senderProfileImage) {
        map.set(m.senderId, avatarFromMessage(m));
      } else if (!existing) {
        map.set(m.senderId, avatarFromMessage(m));
      }
    }
    return map;
  }, [messages, participants]);

  const resolveMessageAvatar = useCallback(
    (m: SerializedChatMessage): AvatarFields => {
      if (m.senderProfileImage) return avatarFromMessage(m);
      return avatarBySenderId.get(m.senderId) ?? avatarFromMessage(m);
    },
    [avatarBySenderId],
  );

  const mergeMessages = useCallback((incoming: SerializedChatMessage[], mode: "replace" | "prepend" | "append") => {
    setMessages((prev) => {
      const map = new Map<string, SerializedChatMessage>();
      const apply = (list: SerializedChatMessage[]) => {
        for (const m of list) {
          const existing = map.get(m.id);
          map.set(m.id, {
            ...existing,
            ...m,
            isMine: m.senderId === viewerId || m.isMine,
            // Keep richer avatar / delivery fields if a later payload omits them.
            senderProfileImage: m.senderProfileImage ?? existing?.senderProfileImage,
            senderProfileImageZoom: m.senderProfileImageZoom ?? existing?.senderProfileImageZoom,
            senderProfileImagePosX: m.senderProfileImagePosX ?? existing?.senderProfileImagePosX,
            senderProfileImagePosY: m.senderProfileImagePosY ?? existing?.senderProfileImagePosY,
            deliveredAt: m.deliveredAt ?? existing?.deliveredAt ?? null,
            seenAt: m.seenAt ?? existing?.seenAt ?? m.readAt ?? existing?.readAt ?? null,
            readAt: m.readAt ?? existing?.readAt ?? null,
            isRead: m.isRead || existing?.isRead || false,
            deliveryStatus:
              m.deliveryStatus === "seen" || existing?.deliveryStatus === "seen"
                ? "seen"
                : m.deliveryStatus === "delivered" || existing?.deliveryStatus === "delivered"
                  ? "delivered"
                  : m.deliveryStatus ?? existing?.deliveryStatus ?? "sent",
            sentAt: m.sentAt ?? existing?.sentAt ?? m.createdAt,
          });
        }
      };
      if (mode === "replace") {
        apply(incoming);
      } else if (mode === "prepend") {
        apply(incoming);
        apply(prev);
      } else {
        apply(prev);
        apply(incoming);
      }
      return [...map.values()].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
    });
  }, [viewerId]);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${requestId}/chat?limit=40`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Could not load chat.");
      }
      const data = (await res.json()) as {
        messages: SerializedChatMessage[];
        hasMore: boolean;
        participants?: ChatParticipant[];
        chatClosed?: boolean;
      };
      mergeMessages(data.messages, "replace");
      if (data.participants) setParticipants(data.participants);
      if (typeof data.chatClosed === "boolean") setChatClosedFromApi(data.chatClosed);
      setHasMore(data.hasMore);
      stickToBottom.current = true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load chat.");
    } finally {
      setLoading(false);
    }
  }, [mergeMessages, requestId]);

  const loadOlder = useCallback(async () => {
    if (!hasMore || loadingMore || messages.length === 0) return;
    setLoadingMore(true);
    try {
      const before = messages[0]?.id;
      const res = await fetch(
        `/api/tickets/${requestId}/chat?limit=30&before=${encodeURIComponent(before)}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        messages: SerializedChatMessage[];
        hasMore: boolean;
      };
      const el = listRef.current;
      const prevHeight = el?.scrollHeight ?? 0;
      mergeMessages(data.messages, "prepend");
      setHasMore(data.hasMore);
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight;
      });
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, mergeMessages, messages, requestId]);

  const markRead = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      // Optimistic local update so we don't re-fire markRead / re-render loops.
      const idSet = new Set(ids);
      const now = new Date().toISOString();
      setMessages((prev) =>
        prev.map((m) =>
          idSet.has(m.id) && !m.isRead
            ? {
                ...m,
                isRead: true,
                readAt: m.readAt ?? now,
                seenAt: m.seenAt ?? now,
                deliveredAt: m.deliveredAt ?? now,
                deliveryStatus: "seen" as const,
              }
            : m,
        ),
      );
      const socket = getRealtimeSocket();
      socket.emit("messages-read", { ticketId: requestId, messageIds: ids });
      void fetch(`/api/tickets/${requestId}/chat`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageIds: ids }),
      }).catch(() => {});
    },
    [requestId],
  );

  useEffect(() => {
    void loadInitial();
    lastScrollMessageId.current = null;
  }, [loadInitial]);

  useEffect(() => {
    if (!open) return;
    const socket = getRealtimeSocket();

    const onConnect = () => {
      setConnected(true);
      setSocketTried(true);
      socket.emit("join-request-chat", { ticketId: requestId }, (res: { ok?: boolean }) => {
        if (!res?.ok) setConnected(false);
      });
    };
    const onDisconnect = () => setConnected(false);
    const onConnectError = () => {
      setConnected(false);
      setSocketTried(true);
    };
    const onNew = (payload: { ticketId?: string; message?: SerializedChatMessage }) => {
      if (payload?.ticketId !== requestId || !payload.message) return;
      mergeMessages([payload.message], "append");
      if (stickToBottom.current) {
        requestAnimationFrame(() => scrollListToBottom(true));
      }
      if (payload.message.senderId !== viewerId) {
        socket.emit("messages-delivered", {
          ticketId: requestId,
          messageIds: [payload.message.id],
        });
        markRead([payload.message.id]);
      }
    };
    const onTyping = (payload: { ticketId?: string; userId?: string; userName?: string }) => {
      if (payload?.ticketId !== requestId || payload.userId === viewerId) return;
      setTypingName(payload.userName || "Someone");
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setTypingName(null), 2500);
    };
    const onStopTyping = (payload: { ticketId?: string; userId?: string }) => {
      if (payload?.ticketId !== requestId) return;
      setTypingName(null);
    };
    const onRead = (payload: { ticketId?: string; messageIds?: string[]; readAt?: string }) => {
      if (payload?.ticketId !== requestId) return;
      const ids = new Set(payload.messageIds ?? []);
      if (ids.size === 0) return;
      const readAt = payload.readAt ?? new Date().toISOString();
      setMessages((prev) =>
        prev.map((m) =>
          ids.has(m.id)
            ? {
                ...m,
                isRead: true,
                readAt: m.readAt ?? readAt,
                seenAt: m.seenAt ?? readAt,
                deliveredAt: m.deliveredAt ?? readAt,
                deliveryStatus: "seen",
              }
            : m,
        ),
      );
    };
    const onDelivered = (payload: {
      ticketId?: string;
      messageIds?: string[];
      deliveredAt?: string;
    }) => {
      if (payload?.ticketId !== requestId) return;
      const ids = new Set(payload.messageIds ?? []);
      if (ids.size === 0) return;
      const deliveredAt = payload.deliveredAt ?? new Date().toISOString();
      setMessages((prev) =>
        prev.map((m) => {
          if (!ids.has(m.id) || m.deliveryStatus === "seen") return m;
          return {
            ...m,
            deliveredAt: m.deliveredAt ?? deliveredAt,
            deliveryStatus: "delivered",
          };
        }),
      );
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("new-message", onNew);
    socket.on("typing", onTyping);
    socket.on("stop-typing", onStopTyping);
    socket.on("messages-read", onRead);
    socket.on("messages-delivered", onDelivered);
    if (socket.connected) onConnect();
    else socket.connect();

    const giveUp = setTimeout(() => setSocketTried(true), 3500);

    // Polling fallback when socket is down (e.g. next dev without server.js).
    pollTimer.current = setInterval(() => {
      if (socket.connected) return;
      void fetch(`/api/tickets/${requestId}/chat?limit=40`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { messages?: SerializedChatMessage[]; participants?: ChatParticipant[]; chatClosed?: boolean } | null) => {
          if (data?.messages) mergeMessages(data.messages, "replace");
          if (data?.participants) setParticipants(data.participants);
          if (typeof data?.chatClosed === "boolean") setChatClosedFromApi(data.chatClosed);
        })
        .catch(() => {});
    }, 12_000);

    return () => {
      clearTimeout(giveUp);
      socket.emit("leave-request-chat", { ticketId: requestId });
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("new-message", onNew);
      socket.off("typing", onTyping);
      socket.off("stop-typing", onStopTyping);
      socket.off("messages-read", onRead);
      socket.off("messages-delivered", onDelivered);
      if (pollTimer.current) clearInterval(pollTimer.current);
      if (typingTimer.current) clearTimeout(typingTimer.current);
    };
  }, [markRead, mergeMessages, open, requestId, scrollListToBottom, viewerId]);

  // Auto-scroll the list only when a new message arrives (not on read receipts / re-polls / typing).
  useEffect(() => {
    if (!open) return;
    const lastId = messages[messages.length - 1]?.id ?? null;
    if (!lastId || lastId === lastScrollMessageId.current) return;
    lastScrollMessageId.current = lastId;
    if (!stickToBottom.current) return;
    scrollListToBottom(false);
  }, [messages, open, scrollListToBottom]);

  useEffect(() => {
    if (!open || messages.length === 0) return;
    const unread = messages.filter((m) => !m.isMine && !m.isRead).map((m) => m.id);
    if (unread.length) markRead(unread);
  }, [markRead, messages, open]);

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stickToBottom.current = nearBottom;
    if (el.scrollTop < 40) void loadOlder();
  }

  function emitTyping() {
    if (chatClosed) return;
    const socket = getRealtimeSocket();
    if (!socket.connected) return;
    socket.emit("typing", { ticketId: requestId });
  }

  async function send() {
    const text = draft.trim();
    if (chatClosed || (!text && files.length === 0) || sending) return;
    setSending(true);
    setError(null);
    const socket = getRealtimeSocket();
    socket.emit("stop-typing", { ticketId: requestId });

    try {
      if (files.length > 0) {
        const form = new FormData();
        form.set("body", text);
        for (const f of files) form.append("files", f);
        const res = await fetch(`/api/tickets/${requestId}/chat`, {
          method: "POST",
          body: form,
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: SerializedChatMessage;
        };
        if (!res.ok) throw new Error(data.error || "Send failed.");
        if (data.message) mergeMessages([data.message], "append");
      } else if (socket.connected) {
        await new Promise<void>((resolve, reject) => {
          socket.emit(
            "send-message",
            { ticketId: requestId, body: text },
            (res: { ok?: boolean; error?: string; message?: SerializedChatMessage }) => {
              if (!res?.ok) {
                reject(new Error(res?.error || "Send failed."));
                return;
              }
              if (res.message) mergeMessages([res.message], "append");
              resolve();
            },
          );
        });
      } else {
        const res = await fetch(`/api/tickets/${requestId}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: text }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: SerializedChatMessage;
        };
        if (!res.ok) throw new Error(data.error || "Send failed.");
        if (data.message) mergeMessages([data.message], "append");
      }
      setDraft("");
      setFiles([]);
      stickToBottom.current = true;
      requestAnimationFrame(() => scrollListToBottom(true));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section
      className={cn(
        "flex max-h-[30rem] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-[0_12px_32px_rgba(15,23,42,0.06)] dark:border-zinc-800 dark:bg-surface",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full shrink-0 items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 text-left dark:border-zinc-800"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">{entityLabel}</p>
            <ParticipantStack participants={participants} />
          </div>
          <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
            {chatClosed
              ? "Closed — this request is closed"
              : connected
                ? "Live"
                : socketTried
                  ? "HTTP mode (no live socket)"
                  : "Connecting…"}
          </p>
        </div>
        {open ? <ChevronUp className="size-4 shrink-0 text-zinc-500" /> : <ChevronDown className="size-4 shrink-0 text-zinc-500" />}
      </button>

      {open ? (
        <>
          <div
            ref={listRef}
            onScroll={onScroll}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3"
          >
            <div className="flex flex-col gap-2">
            {loadingMore ? (
              <p className="text-center text-xs text-zinc-500">Loading older messages…</p>
            ) : hasMore ? (
              <button
                type="button"
                onClick={() => void loadOlder()}
                className="text-center text-xs font-medium text-orange-600 hover:underline dark:text-orange-400"
              >
                Load earlier messages
              </button>
            ) : null}

            {loading ? (
              <p className="py-8 text-center text-sm text-zinc-500">Loading chat…</p>
            ) : messages.length === 0 ? (
              <p className="py-8 text-center text-sm text-zinc-500">
                No messages yet. Start the conversation.
              </p>
            ) : (
              messages.map((m) => {
                const avatar = resolveMessageAvatar(m);
                return (
                  <div
                    key={m.id}
                    className={cn(
                      "flex gap-2",
                      m.isMine ? "flex-row-reverse" : "flex-row",
                    )}
                  >
                    <ChatAvatar person={avatar} className="mt-0.5 size-8" title={m.senderName} />
                    <div
                      className={cn(
                        "flex min-w-0 max-w-[78%] flex-col gap-0.5",
                        m.isMine ? "items-end" : "items-start",
                      )}
                    >
                      <div
                        className={cn(
                          "rounded-2xl px-3 py-2 text-sm",
                          m.isMine
                            ? "bg-orange-600 text-white"
                            : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100",
                        )}
                      >
                        {!m.isMine ? (
                          <p className="mb-0.5 text-[11px] font-semibold opacity-80">{m.senderName}</p>
                        ) : null}
                        <p className="whitespace-pre-wrap break-words">{m.body}</p>
                        {m.attachments?.length ? (
                          <ul className="mt-2 space-y-1">
                            {m.attachments.map((a) => (
                              <li key={a.id}>
                                <a
                                  href={`/api/tickets/${requestId}/chat/files/${encodeURIComponent(a.storedFileName)}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className={cn(
                                    "inline-flex items-center gap-1 text-xs underline-offset-2 hover:underline",
                                    m.isMine ? "text-orange-50" : "text-orange-700 dark:text-orange-300",
                                  )}
                                >
                                  <Paperclip className="size-3" />
                                  {a.fileName}
                                </a>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                      <MessageDeliveryFooter message={m} />
                    </div>
                  </div>
                );
              })
            )}
            {typingName && !chatClosed ? <TypingDotsBubble name={typingName} /> : null}
            <div ref={bottomRef} />
            </div>
          </div>

          {error ? (
            <p className="shrink-0 px-4 pb-2 text-xs text-rose-600 dark:text-rose-400" role="alert">
              {error}
            </p>
          ) : null}

          {chatClosed ? (
            <div className="shrink-0 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <p className="text-center text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Request chat is closed. History remains available for reference.
              </p>
            </div>
          ) : (
          <div className="shrink-0 border-t border-zinc-200 p-3 dark:border-zinc-800">
            {files.length > 0 ? (
              <ul className="mb-2 flex flex-wrap gap-1.5">
                {files.map((f) => (
                  <li
                    key={`${f.name}-${f.size}`}
                    className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] dark:bg-zinc-800"
                  >
                    {f.name}
                    <button
                      type="button"
                      className="text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                      onClick={() => setFiles((prev) => prev.filter((x) => x !== f))}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex items-end gap-2">
              <label className="inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-zinc-300 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900">
                <Paperclip className="size-4" />
                <input
                  type="file"
                  accept={INTAKE_ATTACHMENT_ACCEPT}
                  multiple
                  className="sr-only"
                  onChange={(e) => {
                    const list = Array.from(e.target.files ?? []);
                    setFiles((prev) => [...prev, ...list].slice(0, 5));
                    e.target.value = "";
                  }}
                />
              </label>
              <textarea
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  emitTyping();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={2}
                placeholder="Write a message…"
                className="min-h-[2.5rem] flex-1 resize-none rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm outline-none ring-orange-500/30 focus:border-orange-500 focus:ring dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
              <button
                type="button"
                disabled={sending || (!draft.trim() && files.length === 0)}
                onClick={() => void send()}
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-orange-600 text-white hover:bg-orange-500 disabled:opacity-50"
                aria-label="Send message"
              >
                <Send className="size-4" />
              </button>
            </div>
          </div>
          )}
        </>
      ) : null}
    </section>
  );
}
