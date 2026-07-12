/**
 * Telegram Bot API wrappers + startup webhook registration for the live-chat
 * subsystem. Support conversations are relayed into a supergroup that has forum
 * topics enabled: one topic per ChatSession.
 *
 * Environment (read at call time via process.env so tests can set/mutate them
 * and an unconfigured deploy simply no-ops instead of failing env validation):
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_SUPPORT_CHAT_ID,
 *   TELEGRAM_WEBHOOK_URL, TELEGRAM_WEBHOOK_SECRET
 *
 * Attachments are bidirectional: sendMediaToTopic relays a visitor upload into
 * the topic; getTelegramFile + downloadTelegramFile resolve and fetch agent
 * media (Telegram gives a file_id, never bytes). extractMedia normalizes the
 * various Telegram media objects into a single TelegramMediaRef.
 */
import { createLogger } from "@/lib/logger";
import { getReadyRedis } from "@/lib/chat/redis-lazy";
import type {
  ChatAttachmentType,
  OutboundMedia,
  TelegramApiResponse,
  TelegramFile,
  TelegramForumTopic,
  TelegramMediaRef,
  TelegramMessage,
  TelegramUpdate,
} from "@/lib/chat/types";

const log = createLogger("chat:telegram");

const API_BASE = "https://api.telegram.org";

/** Error kinds so route handlers can branch on the failure mode. */
export type ChatTelegramErrorCode =
  | "TELEGRAM_CONFIG_MISSING"
  | "TELEGRAM_API_ERROR"
  | "TELEGRAM_NETWORK_ERROR"
  // No group is available to receive a new chat (registry empty after init and
  // no env fallback). Surfaced to the send route so it can 403 the visitor.
  | "CHAT_DISABLED";

export class ChatTelegramError extends Error {
  code: ChatTelegramErrorCode;
  telegramCode?: number;
  cause?: unknown;
  constructor(message: string, code: ChatTelegramErrorCode, telegramCode?: number, cause?: unknown) {
    super(message);
    this.name = "ChatTelegramError";
    this.code = code;
    this.telegramCode = telegramCode;
    this.cause = cause;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new ChatTelegramError(`Missing ${name}`, "TELEGRAM_CONFIG_MISSING");
  }
  return value;
}

/**
 * The env fallback support group id. Used as the DEFAULT `targetChatId` for the
 * send helpers so pre-multi-group callers/tests are unchanged; the round-robin
 * registry overrides it by passing an explicit group id (see lib/chat/registry).
 */
export function getSupportChatId(): string {
  return requireEnv("TELEGRAM_SUPPORT_CHAT_ID");
}

/** Escape &<>" for parse_mode:"HTML". */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Single JSON fetch helper: POST api.telegram.org/bot<token>/<method> with a
 * 10s timeout, structured logging, and Telegram ok:false -> TELEGRAM_API_ERROR
 * / network failure -> TELEGRAM_NETWORK_ERROR.
 */
async function telegramFetch<T>(method: string, body: unknown): Promise<T> {
  const token = requireEnv("TELEGRAM_BOT_TOKEN");
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    log.error(`telegram ${method} network error:`, (err as Error).message);
    throw new ChatTelegramError(`Telegram ${method} network error`, "TELEGRAM_NETWORK_ERROR", undefined, err);
  }
  const json = (await res.json().catch(() => ({}))) as TelegramApiResponse<T>;
  if (!json.ok) {
    log.warn(`telegram ${method} api error:`, json.description ?? res.status);
    throw new ChatTelegramError(json.description ?? `Telegram ${method} failed`, "TELEGRAM_API_ERROR", json.error_code);
  }
  return json.result as T;
}

/**
 * Create ONE forum topic (name sliced to 128) in `targetChatId`, defaulting to
 * the env support group. The round-robin dispatcher passes the chosen group id.
 */
export async function createForumTopic(name: string, targetChatId?: string): Promise<TelegramForumTopic> {
  const chatId = targetChatId ?? getSupportChatId();
  return telegramFetch<TelegramForumTopic>("createForumTopic", {
    chat_id: chatId,
    name: name.slice(0, 128),
  });
}

/** Send a text message into a forum topic (text sliced to 4096, HTML). */
export async function sendMessageToTopic(
  text: string,
  threadId: number,
  targetChatId?: string,
): Promise<TelegramMessage> {
  const chatId = targetChatId ?? getSupportChatId();
  return telegramFetch<TelegramMessage>("sendMessage", {
    chat_id: chatId,
    message_thread_id: threadId,
    text: text.slice(0, 4096),
    parse_mode: "HTML",
  });
}

/** Plain (optionally threaded) HTML message — used for /start /pause /end replies. */
export async function sendPlainMessage(
  chatId: string,
  text: string,
  threadId?: number,
): Promise<TelegramMessage> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: text.slice(0, 4096),
    parse_mode: "HTML",
  };
  if (threadId) body.message_thread_id = threadId;
  return telegramFetch<TelegramMessage>("sendMessage", body);
}

/**
 * Close a forum topic. Called when a visitor leaves (close route), on /close,
 * and on /end. Best-effort at the call sites (wrapped in .catch()).
 */
export async function closeForumTopic(chatId: string, threadId: number): Promise<boolean> {
  return telegramFetch<boolean>("closeForumTopic", {
    chat_id: chatId,
    message_thread_id: threadId,
  });
}

/** Group-level admin commands parsed from a message before session resolution. */
export type GroupCommand = "start" | "pause" | "end";

/** Parse /start /pause /end (strips a trailing @botname, case-insensitive). */
export function parseGroupCommand(text?: string): GroupCommand | null {
  if (!text) return null;
  const command = (text.trim().split(/\s+/)[0]?.toLowerCase() ?? "").split("@")[0];
  if (command === "/start") return "start";
  if (command === "/pause") return "pause";
  if (command === "/end") return "end";
  return null;
}

export async function setTelegramWebhook(
  url: string,
  secret: string,
  allowedUpdates: string[] = ["message", "edited_message"],
): Promise<void> {
  await telegramFetch("setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: allowedUpdates,
  });
}

export async function deleteTelegramWebhook(): Promise<void> {
  await telegramFetch("deleteWebhook", {});
}

/**
 * Compare the inbound header to TELEGRAM_WEBHOOK_SECRET. If the secret is unset
 * (local dev without a public webhook), allow through.
 */
export function validateWebhookSecret(header: string | null): boolean {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) return true;
  return header === secret;
}

/** Resolve the forum topic id from a message (direct or via the replied one). */
export function extractThreadId(message: TelegramMessage): number | undefined {
  return message.message_thread_id ?? message.reply_to_message?.message_thread_id;
}

export function isBotMessage(message: TelegramMessage): boolean {
  return message.from?.is_bot ?? false;
}

/** Pull the message (message ?? edited_message) and its text out of an update. */
export function extractUpdateText(update: TelegramUpdate): {
  message?: TelegramMessage;
  text?: string;
} {
  const m = update.message ?? update.edited_message;
  return m ? { message: m, text: m.text } : {};
}

/**
 * Build the HTML context header sent to agents with a visitor's FIRST message:
 * name / email / page / ip / country + the visitor token, then the escaped body.
 */
export function formatVisitorContext(
  text: string,
  ctx: {
    name?: string;
    email?: string;
    pageUrl?: string;
    ip?: string;
    countryCode?: string;
    visitorId: string;
  },
): string {
  const lines: string[] = ["<b>New chat</b>"];
  if (ctx.name) lines.push(`<b>Name:</b> ${escapeHtml(ctx.name)}`);
  if (ctx.email) lines.push(`<b>Email:</b> ${escapeHtml(ctx.email)}`);
  if (ctx.pageUrl) lines.push(`<b>Page:</b> ${escapeHtml(ctx.pageUrl)}`);
  if (ctx.ip) lines.push(`<b>IP:</b> ${escapeHtml(ctx.ip)}`);
  if (ctx.countryCode) lines.push(`<b>Country:</b> ${escapeHtml(ctx.countryCode)}`);
  lines.push(`<b>Token:</b> <code>${escapeHtml(ctx.visitorId)}</code>`);
  lines.push("");
  lines.push(escapeHtml(text));
  return lines.join("\n");
}

/** Later visitor replies are plain HTML-escaped text (no context header). */
export function formatVisitorReply(text: string): string {
  return escapeHtml(text);
}

// --- MEDIA (attachments) ----------------------------------------------------

/** Map an attachment kind -> the Bot API send method + its multipart field. */
function mediaMethodFor(type: ChatAttachmentType): { method: string; field: string } {
  switch (type) {
    case "image":
      return { method: "sendPhoto", field: "photo" };
    case "video":
      return { method: "sendVideo", field: "video" };
    case "audio":
      return { method: "sendAudio", field: "audio" };
    case "voice":
      return { method: "sendVoice", field: "voice" };
    default:
      return { method: "sendDocument", field: "document" };
  }
}

/**
 * OUTBOUND. Relay a visitor file into the forum topic. Builds a multipart
 * FormData (chat_id, message_thread_id, the media Blob under the method's
 * field). A caption is escapeHtml()'d, sliced to 1024, and sent with
 * parse_mode:HTML. 30s timeout; ok:false -> ChatTelegramError.
 */
export async function sendMediaToTopic(
  threadId: number,
  { type, data, fileName, mime, caption }: OutboundMedia,
  targetChatId?: string,
): Promise<TelegramMessage> {
  const token = requireEnv("TELEGRAM_BOT_TOKEN");
  const chatId = targetChatId ?? getSupportChatId();
  const { method, field } = mediaMethodFor(type);

  const form = new FormData();
  form.set("chat_id", chatId);
  form.set("message_thread_id", String(threadId));
  if (caption) {
    form.set("caption", escapeHtml(caption).slice(0, 1024));
    form.set("parse_mode", "HTML");
  }
  const view = new Uint8Array(data);
  form.set(field, new Blob([view], { type: mime || "application/octet-stream" }), fileName);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/bot${token}/${method}`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new ChatTelegramError(`Telegram ${method} network error`, "TELEGRAM_NETWORK_ERROR", undefined, err);
  }
  const json = (await res.json().catch(() => ({}))) as TelegramApiResponse<TelegramMessage>;
  if (!json.ok) {
    throw new ChatTelegramError(json.description ?? `Telegram ${method} failed`, "TELEGRAM_API_ERROR", json.error_code);
  }
  return json.result as TelegramMessage;
}

/** INBOUND step 1. Resolve a file_id to a TelegramFile carrying a file_path. */
export async function getTelegramFile(fileId: string): Promise<TelegramFile> {
  return telegramFetch<TelegramFile>("getFile", { file_id: fileId });
}

/**
 * INBOUND step 2. Download the raw bytes from the FILE host (a DIFFERENT base
 * URL than the API host): api.telegram.org/file/bot<token>/<file_path>.
 */
export async function downloadTelegramFile(filePath: string): Promise<Buffer> {
  const token = requireEnv("TELEGRAM_BOT_TOKEN");
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/file/bot${token}/${filePath}`, {
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new ChatTelegramError("Telegram file download network error", "TELEGRAM_NETWORK_ERROR", undefined, err);
  }
  if (!res.ok) {
    throw new ChatTelegramError(`Telegram file download failed (${res.status})`, "TELEGRAM_API_ERROR", res.status);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Short unique-ish suffix for derived file names. */
function uniqueSuffix(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * INBOUND normalizer. Inspect a TelegramMessage and return a TelegramMediaRef
 * or null. For `photo` (an array of sizes) it picks the LARGEST by file_size
 * and derives fileName/mime. Other kinds prefer Telegram's file_name/mime_type
 * with sensible fallbacks. Carries the caption.
 */
export function extractMedia(message: TelegramMessage): TelegramMediaRef | null {
  const caption = message.caption;

  if (Array.isArray(message.photo) && message.photo.length > 0) {
    const largest = message.photo.reduce((a, b) => ((b.file_size ?? 0) >= (a.file_size ?? 0) ? b : a));
    return {
      type: "image",
      fileId: largest.file_id,
      fileName: `photo-${uniqueSuffix()}.jpg`,
      mime: "image/jpeg",
      size: largest.file_size ?? 0,
      caption,
    };
  }

  if (message.video) {
    return {
      type: "video",
      fileId: message.video.file_id,
      fileName: message.video.file_name ?? `video-${uniqueSuffix()}.mp4`,
      mime: message.video.mime_type ?? "video/mp4",
      size: message.video.file_size ?? 0,
      caption,
    };
  }

  if (message.audio) {
    return {
      type: "audio",
      fileId: message.audio.file_id,
      fileName: message.audio.file_name ?? `audio-${uniqueSuffix()}.mp3`,
      mime: message.audio.mime_type ?? "audio/mpeg",
      size: message.audio.file_size ?? 0,
      caption,
    };
  }

  if (message.voice) {
    return {
      type: "voice",
      fileId: message.voice.file_id,
      fileName: `voice-${uniqueSuffix()}.ogg`,
      mime: message.voice.mime_type ?? "audio/ogg",
      size: message.voice.file_size ?? 0,
      caption,
    };
  }

  if (message.document) {
    return {
      type: "document",
      fileId: message.document.file_id,
      fileName: message.document.file_name ?? `file-${uniqueSuffix()}`,
      mime: message.document.mime_type ?? "application/octet-stream",
      size: message.document.file_size ?? 0,
      caption,
    };
  }

  return null;
}

// --- startup webhook registration (Redis-coordinated) ----------------------

const WEBHOOK_LOCK_KEY = "chat:webhook:lock";
const WEBHOOK_STATE_KEY = "chat:webhook:state";
const WEBHOOK_REREGISTER_INTERVAL_MS = 30_000;

/**
 * Register the Telegram webhook on server startup. Uses Redis keys to store a
 * config hash + timestamp and a short NX lock so only ONE clustered worker
 * registers at a time; re-registers when the config changed or the last
 * registration is stale. If Redis is unavailable, registers directly.
 */
export async function ensureTelegramWebhook(): Promise<void> {
  const url = process.env.TELEGRAM_WEBHOOK_URL;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!url || !secret || !token) return; // no-op when unconfigured

  const allowedUpdates = ["message", "edited_message"]; // forum_topic_closed arrives inside "message"
  const configHash = `${url}|${allowedUpdates.join(",")}`;

  const redis = await getReadyRedis();
  if (!redis) {
    await deleteTelegramWebhook().catch(() => {});
    await setTelegramWebhook(url, secret, allowedUpdates);
    log.info("telegram webhook registered (no redis)");
    return;
  }

  const now = Date.now();
  const lock = await redis.set(WEBHOOK_LOCK_KEY, String(now), "EX", 30, "NX");
  if (lock !== "OK") return; // another worker is handling it

  try {
    const stateRaw = await redis.get(WEBHOOK_STATE_KEY);
    const state = stateRaw ? (JSON.parse(stateRaw) as { hash?: string; at?: number }) : null;
    const fresh = state?.at ? now - state.at < WEBHOOK_REREGISTER_INTERVAL_MS : false;
    if (state?.hash === configHash && fresh) return;

    await deleteTelegramWebhook().catch(() => {});
    await setTelegramWebhook(url, secret, allowedUpdates);
    await redis.set(WEBHOOK_STATE_KEY, JSON.stringify({ hash: configHash, at: now }));
    log.info("telegram webhook registered");
  } finally {
    await redis.del(WEBHOOK_LOCK_KEY).catch(() => {});
  }
}
