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
  listOpenChatSessionsByChatId,
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
  parseGroupCommand,
  sendPlainMessage,
  closeForumTopic,
  type GroupCommand,
} from "@/lib/chat/telegram";
import {
  registerGroup,
  pauseGroup,
  removeGroup,
  listGroups,
} from "@/lib/chat/registry";
import { saveChatFile, deleteSessionFiles } from "@/lib/chat/storage";
import { publishChatEvent } from "@/lib/chat/pubsub";
import type { TelegramMessage, TelegramUpdate } from "@/lib/chat/types";
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

  // Group-level admin commands (/start /pause /end) are handled BEFORE session
  // resolution: they operate on message.chat.id, not on any conversation.
  const groupCommand = parseGroupCommand(text);
  if (groupCommand && message.chat) {
    return handleGroupCommand(groupCommand, message);
  }

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
      // Close the Telegram topic too (unless the topic-closed event already did).
      if (!message.forum_topic_closed && session.telegramChatId && session.telegramThreadId) {
        await closeForumTopic(session.telegramChatId, session.telegramThreadId).catch(() => {});
      }
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

/**
 * Handle a group-level command in the group it was sent from. Always acks 200
 * (even on failure) so Telegram stops retrying; replies in the same thread.
 */
async function handleGroupCommand(command: GroupCommand, message: TelegramMessage) {
  const chatId = String(message.chat!.id);
  const title = message.chat!.title;
  const threadId = message.message_thread_id;
  try {
    if (command === "start") {
      await registerGroup(chatId, title);
      const active = (await listGroups()).filter((g) => !g.paused).length;
      await sendPlainMessage(
        chatId,
        `\u2705 This group is now receiving live chats (round-robin across <b>${active}</b> active group${active === 1 ? "" : "s"}).`,
        threadId,
      );
      return ok({ ok: true });
    }
    if (command === "pause") {
      const paused = await pauseGroup(chatId);
      await sendPlainMessage(
        chatId,
        paused
          ? "\u23f8\ufe0f Paused. Existing chats continue, but no new chats will be routed here until you send /start."
          : "This group is not registered. Send /start to begin receiving chats.",
        threadId,
      );
      return ok({ ok: true });
    }
    // end: close every open session in this group, then unregister it.
    const sessions = await listOpenChatSessionsByChatId(chatId);
    for (const s of sessions) {
      await closeChatSession(s.id);
      await deleteSessionFiles(s.id);
      if (s.telegramChatId && s.telegramThreadId) {
        await closeForumTopic(s.telegramChatId, s.telegramThreadId).catch(() => {});
      }
      await publishChatEvent(s.id, { type: "status", sessionId: s.id, status: "closed" });
    }
    await removeGroup(chatId);
    const remaining = (await listGroups()).filter((g) => !g.paused).length;
    await sendPlainMessage(
      chatId,
      `\ud83d\uded1 Ended <b>${sessions.length}</b> chat${sessions.length === 1 ? "" : "s"} and unregistered this group.` +
        (remaining === 0 ? " Live chat is now disabled (no active groups)." : ""),
      threadId,
    );
    return ok({ ok: true });
  } catch (err) {
    log.error("group command failed:", (err as Error).message);
    await sendPlainMessage(chatId, "\u26a0\ufe0f Command failed. Please try again.", threadId).catch(() => {});
    return ok({ ok: true });
  }
}
