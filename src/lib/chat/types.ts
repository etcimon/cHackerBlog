/**
 * Shared contracts for the live-chat subsystem.
 *
 * The DTOs are the wire shape sent to the browser (over the send/close JSON
 * responses and the SSE stream). Attachments are represented by METADATA only:
 * the raw bytes are never embedded, they are fetched separately through the
 * authenticated GET /api/chat/attachments/[id] route (mirroring Telegram's own
 * file_id -> getFile -> download indirection). No storage path/URL is ever
 * exposed on the wire.
 */

/** Who authored a message. */
export type ChatDirection = "visitor" | "support";

/** Coarse attachment bucket used for storage, rendering, and Telegram method. */
export type ChatAttachmentType = "image" | "video" | "audio" | "voice" | "document";

/**
 * Metadata-only attachment descriptor carried in a ChatMessageDto. NB: never
 * the path/bytes — only what the client needs to render + label the file.
 */
export interface ChatAttachmentDto {
  type: ChatAttachmentType;
  name: string;
  mime: string;
  size: number;
}

/**
 * A single message on the wire. `text` may be "" for an attachment-only
 * message; `attachment` is present only when the row carries a file.
 */
export interface ChatMessageDto {
  id: string;
  chatSessionId: string;
  direction: ChatDirection;
  text: string;
  errorText?: string;
  attachment?: ChatAttachmentDto;
  createdAt: string;
}

/** The conversation as seen by the client (no Telegram/topic internals). */
export interface ChatSessionDto {
  id: string;
  visitorId: string;
  name?: string;
  email?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/** Pub/sub payload: a discriminated union on `type`. */
export type ChatEvent =
  | { type: "message"; sessionId: string; message: ChatMessageDto }
  | { type: "status"; sessionId: string; status: string };

// --- Telegram API shapes (only the fields this subsystem reads) -------------

export interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export interface TelegramForumTopic {
  message_thread_id: number;
  name?: string;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  width?: number;
  height?: number;
}

export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramVideo {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramAudio {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
  duration?: number;
}

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
  title?: string;
}

export interface TelegramMessage {
  message_id: number;
  message_thread_id?: number;
  chat?: TelegramChat;
  from?: TelegramUser;
  text?: string;
  caption?: string;
  reply_to_message?: TelegramMessage;
  forum_topic_closed?: Record<string, unknown>;
  forum_topic_reopened?: Record<string, unknown>;
  photo?: TelegramPhotoSize[];
  video?: TelegramVideo;
  document?: TelegramDocument;
  audio?: TelegramAudio;
  voice?: TelegramAudio;
}

export interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

/** Result of the getFile Bot API method. */
export interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

/** Normalized inbound media reference produced by extractMedia(). */
export interface TelegramMediaRef {
  type: ChatAttachmentType;
  fileId: string;
  fileName: string;
  mime: string;
  size: number;
  caption?: string;
}

/** Inline input to sendMediaToTopic (no separate exported request type). */
export interface OutboundMedia {
  type: ChatAttachmentType;
  data: Uint8Array;
  fileName: string;
  mime: string;
  caption?: string;
}
