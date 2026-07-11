/**
 * Inbound Telegram webhook (POST). Authenticates the secret-token header, then
 * resolves the update to a session (by forum thread id, else by the replied
 * message id) and relays agent replies / media / /close to the visitor's SSE
 * stream. Agent media is getFile + downloaded, stored, and broadcast with
 * attachment metadata. Unknown updates are acked so Telegram stops retrying.
 */
import { fail, ok, Errors } from "@/lib/errors";
import {
  findChatSessionByThreadId,
  findChatSessionByTelegramMessageId,
  createChatMessage,
  closeChatSession,
  toMessageDto,
} from "@/lib/chat/db";
import {
  validateWebhookSecret,
  extractUpdateText,
  isBotMessage,
  extractThreadId,
  extractMedia,
  getTelegramFile,
  downloadTelegramFile,
} from "@/lib/chat/telegram";
import { saveChatFile, deleteSessionFiles } from "@/lib/chat/storage";
import { publishChatEvent } from "@/lib/chat/pubsub";
import type { TelegramUpdate } from "@/lib/chat/types";
import { createLogger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("api:chat:telegram");

export async function POST(req: Request) {
  if (!validateWebhookSecret(req.headers.get("x-telegram-bot-api-secret-token"))) {
    return fail(Errors.unauthorized("Invalid webhook secret"));
  }

  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return ok({ ok: true });
  }

  const { message, text } = extractUpdateText(update);
  if (!message) return ok({ ok: true });
  if (isBotMessage(message)) return ok({ ok: true });

  const threadId = extractThreadId(message);
  let session = threadId ? await findChatSessionByThreadId(threadId) : null;
  if (!session && message.reply_to_message?.message_id) {
    session = await findChatSessionByTelegramMessageId(message.reply_to_message.message_id);
  }
  if (!session) return ok({ ok: true });

  // "/close" command OR a forum_topic_closed service message ends the session.
  if (text?.trim() === "/close" || message.forum_topic_closed) {
    const updated = await closeChatSession(session.id);
    if (updated) {
      await deleteSessionFiles(session.id);
      await publishChatEvent(session.id, {
        type: "status",
        sessionId: session.id,
        status: "closed",
      });
    }
    return ok({ ok: true });
  }

  // Agent-sent media (runs BEFORE the !text guard so caption-less media works).
  const media = extractMedia(message);
  if (media) {
    try {
      const file = await getTelegramFile(media.fileId);
      if (!file.file_path) throw new Error("getFile returned no file_path");
      const bytes = await downloadTelegramFile(file.file_path);
      const storedPath = await saveChatFile(session.id, media.fileName, new Uint8Array(bytes));
      const dbMessage = await createChatMessage({
        chatSessionId: session.id,
        direction: "support",
        text: media.caption ?? "",
        telegramMessageId: message.message_id,
        attachmentType: media.type,
        attachmentName: media.fileName,
        attachmentMime: media.mime,
        attachmentSize: bytes.byteLength,
        attachmentPath: storedPath,
      });
      await publishChatEvent(session.id, {
        type: "message",
        sessionId: session.id,
        message: toMessageDto(dbMessage),
      });
    } catch (err) {
      log.warn("inbound media retrieval failed:", (err as Error).message);
      const dbMessage = await createChatMessage({
        chatSessionId: session.id,
        direction: "support",
        text: media.caption ?? "",
        telegramMessageId: message.message_id,
        errorText: "Attachment could not be retrieved from Telegram.",
      });
      await publishChatEvent(session.id, {
        type: "message",
        sessionId: session.id,
        message: toMessageDto(dbMessage),
      });
    }
    return ok({ ok: true });
  }

  if (!text) return ok({ ok: true });

  const dbMessage = await createChatMessage({
    chatSessionId: session.id,
    direction: "support",
    text,
    telegramMessageId: message.message_id,
  });
  await publishChatEvent(session.id, {
    type: "message",
    sessionId: session.id,
    message: toMessageDto(dbMessage),
  });
  return ok({ ok: true });
}
