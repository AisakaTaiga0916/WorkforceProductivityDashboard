/** Client-safe chat types (no Node/fs imports). */

export type ChatAttachmentMeta = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storedFileName: string;
};

export type ChatPersonAvatar = {
  profileImage: string | null;
  profileImageZoom: number;
  profileImagePosX: number;
  profileImagePosY: number;
};

/** Request-chat participant shown in the header stack. */
export type ChatParticipant = ChatPersonAvatar & {
  key: string;
  role: string;
  name: string;
  email: string | null;
  portalAccountId: string | null;
  agentId: string | null;
};

/** Lifecycle of an outbound chat message (WhatsApp-style). */
export type ChatDeliveryStatus = "sent" | "delivered" | "seen";

export type SerializedChatMessage = {
  id: string;
  ticketId: string;
  senderId: string;
  senderName: string;
  senderRole: string | null;
  body: string;
  attachments: ChatAttachmentMeta[];
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
  isMine: boolean;
  /** sent → delivered → seen */
  deliveryStatus: ChatDeliveryStatus;
  /** Same as createdAt (when the server accepted the message). */
  sentAt: string;
  deliveredAt: string | null;
  /** Same as readAt when first other participant saw it. */
  seenAt: string | null;
  senderProfileImage?: string | null;
  senderProfileImageZoom?: number;
  senderProfileImagePosX?: number;
  senderProfileImagePosY?: number;
};

export const MAX_CHAT_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_CHAT_ATTACHMENTS_PER_MESSAGE = 5;
export const MAX_CHAT_BODY_LENGTH = 4_000;

export function resolveChatDeliveryStatus(row: {
  isRead: boolean;
  readAt?: Date | string | null;
  deliveredAt?: Date | string | null;
}): ChatDeliveryStatus {
  if (row.isRead || row.readAt) return "seen";
  if (row.deliveredAt) return "delivered";
  return "sent";
}
