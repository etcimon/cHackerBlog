/**
 * Thin, traced Prisma wrappers for the chat subsystem plus the DTO mappers that
 * turn a persisted row into the client wire shape.
 *
 * Attachment metadata lives ON the message row (one optional file per message).
 * toMessageDto exposes that metadata as a nested `attachment` object but NEVER
 * the storage path/bytes — those are served separately by the authenticated
 * attachment route.
 */
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import type {
  ChatAttachmentType,
  ChatDirection,
  ChatMessageDto,
  ChatSessionDto,
} from "@/lib/chat/types";

const log = createLogger("chat:db");

export interface CreateSessionInput {
  visitorId: string;
  name?: string;
  email?: string;
  ip?: string | null;
  countryCode?: string;
  pageUrl?: string;
  userAgent?: string | null;
}

export interface UpdateSessionInput {
  name?: string;
  email?: string;
  pageUrl?: string;
  countryCode?: string;
}

export interface CreateMessageInput {
  chatSessionId: string;
  direction: ChatDirection;
  text: string;
  telegramMessageId?: number;
  errorText?: string;
  attachmentType?: ChatAttachmentType;
  attachmentName?: string;
  attachmentMime?: string;
  attachmentSize?: number;
  attachmentPath?: string;
}

type SessionRow = Awaited<ReturnType<typeof prisma.chatSession.findUnique>>;
type MessageRow = Awaited<ReturnType<typeof prisma.chatMessage.findUnique>>;

export async function findChatSessionByVisitorId(visitorId: string) {
  try {
    return await prisma.chatSession.findUnique({ where: { visitorId } });
  } catch (err) {
    log.error("findChatSessionByVisitorId:", (err as Error).message);
    throw err;
  }
}

export async function findChatSessionById(id: string) {
  return prisma.chatSession.findUnique({ where: { id } });
}

export async function findChatSessionByThreadId(threadId: number) {
  return prisma.chatSession.findFirst({ where: { telegramThreadId: threadId } });
}

export async function findChatSessionByTelegramMessageId(messageId: number) {
  const msg = await prisma.chatMessage.findFirst({
    where: { telegramMessageId: messageId },
    include: { chatSession: true },
  });
  return msg?.chatSession ?? null;
}

export async function createChatSession(input: CreateSessionInput) {
  return prisma.chatSession.create({
    data: {
      visitorId: input.visitorId,
      name: input.name ?? null,
      email: input.email ?? null,
      ip: input.ip ?? null,
      countryCode: input.countryCode ?? null,
      pageUrl: input.pageUrl ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}

/** Merge new intake fields into an existing row without clobbering values. */
export async function updateChatSession(id: string, input: UpdateSessionInput) {
  const data: Record<string, unknown> = {};
  if (input.name) data.name = input.name;
  if (input.email) data.email = input.email;
  if (input.pageUrl) data.pageUrl = input.pageUrl;
  if (input.countryCode) data.countryCode = input.countryCode;
  if (Object.keys(data).length === 0) {
    return prisma.chatSession.findUnique({ where: { id } });
  }
  return prisma.chatSession.update({ where: { id }, data });
}

/** Persist the Telegram topic mapping after the first send. */
export async function updateChatSessionThread(id: string, chatId: string, threadId: number) {
  return prisma.chatSession.update({
    where: { id },
    data: { telegramChatId: chatId, telegramThreadId: threadId },
  });
}

export async function createChatMessage(input: CreateMessageInput) {
  return prisma.chatMessage.create({
    data: {
      chatSessionId: input.chatSessionId,
      direction: input.direction,
      text: input.text ?? "",
      telegramMessageId: input.telegramMessageId ?? null,
      errorText: input.errorText ?? null,
      attachmentType: input.attachmentType ?? null,
      attachmentName: input.attachmentName ?? null,
      attachmentMime: input.attachmentMime ?? null,
      attachmentSize: input.attachmentSize ?? null,
      attachmentPath: input.attachmentPath ?? null,
    },
  });
}

export async function listChatMessages(sessionId: string) {
  return prisma.chatMessage.findMany({
    where: { chatSessionId: sessionId },
    orderBy: { createdAt: "asc" },
  });
}

/** Message + its owning session (for the attachment route's authorization). */
export async function getChatMessageWithSession(id: string) {
  return prisma.chatMessage.findUnique({
    where: { id },
    include: { chatSession: true },
  });
}

export async function closeChatSession(id: string) {
  try {
    return await prisma.chatSession.update({ where: { id }, data: { status: "closed" } });
  } catch (err) {
    log.error("closeChatSession:", (err as Error).message);
    return null;
  }
}

export async function closeChatSessionByVisitorId(visitorId: string) {
  return prisma.chatSession.update({ where: { visitorId }, data: { status: "closed" } });
}

// --- DTO mappers ------------------------------------------------------------

export function toMessageDto(m: NonNullable<MessageRow>): ChatMessageDto {
  const dto: ChatMessageDto = {
    id: m.id,
    chatSessionId: m.chatSessionId,
    direction: m.direction as ChatDirection,
    text: m.text,
    createdAt: (m.createdAt instanceof Date ? m.createdAt : new Date(m.createdAt)).toISOString(),
  };
  if (m.errorText) dto.errorText = m.errorText;
  if (m.attachmentType) {
    dto.attachment = {
      type: m.attachmentType as ChatAttachmentType,
      name: m.attachmentName ?? "file",
      mime: m.attachmentMime ?? "application/octet-stream",
      size: m.attachmentSize ?? 0,
    };
  }
  return dto;
}

export function toSessionDto(s: NonNullable<SessionRow>): ChatSessionDto {
  const dto: ChatSessionDto = {
    id: s.id,
    visitorId: s.visitorId,
    status: s.status,
    createdAt: (s.createdAt instanceof Date ? s.createdAt : new Date(s.createdAt)).toISOString(),
    updatedAt: (s.updatedAt instanceof Date ? s.updatedAt : new Date(s.updatedAt)).toISOString(),
  };
  if (s.name) dto.name = s.name;
  if (s.email) dto.email = s.email;
  return dto;
}
