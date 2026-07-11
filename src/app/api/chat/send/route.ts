/**
 * Visitor -> Telegram relay (POST). ONE route, TWO content types:
 *   - application/json    -> a plain text message
 *   - multipart/form-data -> a caption PLUS one file attachment
 *
 * Session resolution + topic creation are shared by both paths. Telegram
 * delivery is best-effort: a failure is recorded on the persisted message via
 * `errorText` (never a hard error) so the visitor always sees their own
 * message/upload. Attachments are stored on disk FIRST, then relayed.
 */
import { z } from "zod";
import { ok, fail, Errors, AppError } from "@/lib/errors";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { lookupGeo } from "@/lib/ip-geo";
import {
  findChatSessionByVisitorId,
  createChatSession,
  updateChatSession,
  updateChatSessionThread,
  createChatMessage,
  listChatMessages,
  toMessageDto,
  toSessionDto,
} from "@/lib/chat/db";
import {
  ChatTelegramError,
  createForumTopic,
  sendMessageToTopic,
  sendMediaToTopic,
  formatVisitorContext,
  formatVisitorReply,
} from "@/lib/chat/telegram";
import {
  attachmentTypeFromMime,
  clientAttachmentsEnabled,
  maxUploadBytes,
  saveChatFile,
} from "@/lib/chat/storage";
import { publishChatEvent } from "@/lib/chat/pubsub";
import { randomUUID } from "node:crypto";
import { createLogger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("api:chat:send");

const sendSchema = z.object({
  visitorId: z.string().min(1).max(100).optional(),
  name: z.string().max(100).optional(),
  email: z.string().email().max(255).optional().or(z.literal("")),
  message: z.string().min(1).max(2000),
  pageUrl: z.string().url().max(1000).optional().or(z.literal("")),
});

const uploadFieldsSchema = z.object({
  visitorId: z.string().min(1).max(100).optional(),
  name: z.string().max(100).optional(),
  email: z.string().email().max(255).optional().or(z.literal("")),
  message: z.string().max(2000).optional(),
  pageUrl: z.string().url().max(1000).optional().or(z.literal("")),
});

interface SessionContext {
  visitorId?: string;
  name?: string;
  email?: string;
  pageUrl?: string;
  ip?: string | null;
  countryCode?: string;
  userAgent?: string | null;
}

/** Find-or-create by visitorId; merge new intake fields into an existing row. */
async function findOrCreateSession(ctx: SessionContext) {
  let session = ctx.visitorId ? await findChatSessionByVisitorId(ctx.visitorId) : null;
  if (!session) {
    session = await createChatSession({
      visitorId: ctx.visitorId || randomUUID(),
      name: ctx.name,
      email: ctx.email,
      ip: ctx.ip,
      countryCode: ctx.countryCode,
      pageUrl: ctx.pageUrl,
      userAgent: ctx.userAgent,
    });
  } else if (ctx.name || ctx.email || ctx.pageUrl || ctx.countryCode) {
    session =
      (await updateChatSession(session.id, {
        name: ctx.name,
        email: ctx.email,
        pageUrl: ctx.pageUrl,
        countryCode: ctx.countryCode,
      })) ?? session;
  }
  return session!;
}

/** Lazily create ONE forum topic per session; throws ChatTelegramError. */
async function ensureTopic<T extends { id: string; telegramThreadId: number | null; name: string | null; visitorId: string }>(
  session: T,
) {
  if (session.telegramThreadId) return session;
  const topicName = `Chat: ${session.name ?? session.visitorId.slice(0, 8)}`;
  const topic = await createForumTopic(topicName);
  const updated = await updateChatSessionThread(
    session.id,
    process.env.TELEGRAM_SUPPORT_CHAT_ID ?? "",
    topic.message_thread_id,
  );
  return updated as unknown as T;
}

export async function POST(req: Request) {
  const ip = getClientIp(req.headers);
  const rl = await rateLimit(ip, "chat.send", { max: 30, windowSeconds: 60 });
  if (!rl.allowed) return fail(Errors.rateLimited("Chat send rate limit reached"));

  try {
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) return await handleUpload(req, ip);
    return await handleText(req, ip);
  } catch (err) {
    if (err instanceof SyntaxError) return fail(new AppError("Invalid request body", 422, "VALIDATION_ERROR"));
    return fail(err);
  }
}

async function handleText(req: Request, ip: string) {
  const parsed = sendSchema.safeParse(await req.json());
  if (!parsed.success) return fail(parsed.error);
  const { visitorId, name, email, message, pageUrl } = parsed.data;

  const geo = await lookupGeo(ip);
  let session = await findOrCreateSession({
    visitorId,
    name,
    email: email || undefined,
    pageUrl: pageUrl || undefined,
    countryCode: geo?.country,
    ip,
    userAgent: req.headers.get("user-agent"),
  });
  if (session.status === "closed") {
    return fail(new AppError("This chat session has been closed.", 422, "VALIDATION_ERROR"));
  }

  const hadTopic = Boolean(session.telegramThreadId);
  if (!hadTopic) {
    try {
      session = await ensureTopic(session);
    } catch (err) {
      // Persist the visitor's message with a delivery-error badge and surface it.
      const dbMessage = await createChatMessage({
        chatSessionId: session.id,
        direction: "visitor",
        text: message,
        errorText: `Failed to open support channel${err instanceof ChatTelegramError ? `: ${err.message}` : ""}`,
      });
      await publishChatEvent(session.id, {
        type: "message",
        sessionId: session.id,
        message: toMessageDto(dbMessage),
      });
      return ok({
        session: toSessionDto(session),
        visitorId: session.visitorId,
        messages: (await listChatMessages(session.id)).map(toMessageDto),
      });
    }
  }

  const telegramText = hadTopic
    ? formatVisitorReply(message)
    : formatVisitorContext(message, {
        name,
        email: email || undefined,
        pageUrl: pageUrl || undefined,
        ip,
        countryCode: geo?.country,
        visitorId: session.visitorId,
      });

  let telegramMessageId: number | undefined;
  try {
    telegramMessageId = (await sendMessageToTopic(telegramText, session.telegramThreadId!)).message_id;
  } catch (err) {
    log.warn("telegram send failed:", (err as Error).message);
  }

  const dbMessage = await createChatMessage({
    chatSessionId: session.id,
    direction: "visitor",
    text: message,
    telegramMessageId,
    errorText: telegramMessageId ? undefined : "Failed to deliver to Telegram",
  });
  await publishChatEvent(session.id, {
    type: "message",
    sessionId: session.id,
    message: toMessageDto(dbMessage),
  });

  return ok({
    session: toSessionDto(session),
    visitorId: session.visitorId,
    messages: (await listChatMessages(session.id)).map(toMessageDto),
  });
}

async function handleUpload(req: Request, ip: string) {
  // SERVER-SIDE kill-switch: the NEXT_PUBLIC_* flag only hides the client picker.
  if (!clientAttachmentsEnabled()) return fail(Errors.forbidden("Attachments are disabled."));

  const form = await req.formData();
  const fields = uploadFieldsSchema.safeParse({
    visitorId: form.get("visitorId") ?? undefined,
    name: form.get("name") ?? undefined,
    email: form.get("email") ?? undefined,
    message: form.get("message") ?? undefined,
    pageUrl: form.get("pageUrl") ?? undefined,
  });
  if (!fields.success) return fail(fields.error);

  const file = form.get("file");
  if (!(file instanceof File)) return fail(new AppError("No file provided.", 422, "VALIDATION_ERROR"));
  if (file.size === 0) return fail(new AppError("The uploaded file is empty.", 422, "VALIDATION_ERROR"));
  if (file.size > maxUploadBytes()) {
    return fail(new AppError("File exceeds the maximum allowed size.", 422, "VALIDATION_ERROR"));
  }

  const { visitorId, name, email, message, pageUrl } = fields.data;
  const caption = (message || "").trim();

  const geo = await lookupGeo(ip);
  let session = await findOrCreateSession({
    visitorId,
    name,
    email: email || undefined,
    pageUrl: pageUrl || undefined,
    countryCode: geo?.country,
    ip,
    userAgent: req.headers.get("user-agent"),
  });
  if (session.status === "closed") {
    return fail(new AppError("This chat session has been closed.", 422, "VALIDATION_ERROR"));
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = file.type || "application/octet-stream";
  const attachmentType = attachmentTypeFromMime(mime);
  const fileName = file.name || `upload-${Date.now()}`;

  // STORE FIRST, relay second — the visitor always sees their own upload.
  const storedPath = await saveChatFile(session.id, fileName, bytes);

  let sendError: ChatTelegramError | null = null;
  let telegramMessageId: number | undefined;
  try {
    session = await ensureTopic(session);
    telegramMessageId = (
      await sendMediaToTopic(session.telegramThreadId!, {
        type: attachmentType,
        data: bytes,
        fileName,
        mime,
        caption: caption || undefined,
      })
    ).message_id;
  } catch (err) {
    sendError = err instanceof ChatTelegramError ? err : null;
    log.warn("telegram media send failed:", (err as Error).message);
  }

  const dbMessage = await createChatMessage({
    chatSessionId: session.id,
    direction: "visitor",
    text: caption,
    telegramMessageId,
    attachmentType,
    attachmentName: fileName,
    attachmentMime: mime,
    attachmentSize: bytes.byteLength,
    attachmentPath: storedPath,
    errorText: telegramMessageId
      ? undefined
      : `Failed to deliver attachment to Telegram${sendError ? `: ${sendError.message}` : ""}`,
  });
  await publishChatEvent(session.id, {
    type: "message",
    sessionId: session.id,
    message: toMessageDto(dbMessage),
  });

  return ok({
    session: toSessionDto(session),
    visitorId: session.visitorId,
    messages: (await listChatMessages(session.id)).map(toMessageDto),
  });
}
