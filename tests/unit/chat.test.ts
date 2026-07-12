/**
 * Unit tests for the live-chat subsystem's transport-agnostic core:
 *   - storage.ts   : on-disk attachment store + config helpers + traversal guard
 *   - telegram.ts  : pure helpers + media send/getFile/download (fetch mocked)
 *   - pubsub.ts    : in-memory fanout (CACHE_DRIVER=memory forces the memory bus)
 *   - db.ts        : DTO mappers (pure row -> wire shape)
 *
 * Redis and Telegram are never contacted for real: the memory driver keeps
 * pub/sub in-process and globalThis.fetch is stubbed for the Telegram calls.
 */

// Set env BEFORE importing modules that read it at import time (lib/env.ts).
process.env.DATABASE_URL = process.env.DATABASE_URL || "file:./test.sqlite";
process.env.CACHE_DRIVER = "memory";
process.env.TELEGRAM_BOT_TOKEN = "test-bot-token";
process.env.TELEGRAM_SUPPORT_CHAT_ID = "-100999";

import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";

import {
  attachmentTypeFromMime,
  clientAttachmentsEnabled,
  maxUploadBytes,
  safeFileName,
  saveChatFile,
  readChatFile,
  deleteSessionFiles,
  resolveStoredPath,
} from "@/lib/chat/storage";
import {
  escapeHtml,
  extractMedia,
  extractThreadId,
  extractUpdateText,
  isBotMessage,
  formatVisitorContext,
  validateWebhookSecret,
  getTelegramFile,
  downloadTelegramFile,
  sendMediaToTopic,
  setTelegramWebhook,
  getTelegramWebhookInfo,
  ensureTelegramWebhook,
} from "@/lib/chat/telegram";
import { publishChatEvent, subscribeChatEvents, chatChannel } from "@/lib/chat/pubsub";
import { toMessageDto, toSessionDto } from "@/lib/chat/db";
import type { ChatEvent, TelegramMessage } from "@/lib/chat/types";

// Point the attachment store at a throwaway tmp folder for the whole file.
const TMP_ROOT = path.join(os.tmpdir(), `chat-test-${randomUUID()}`);
process.env.CHAT_UPLOAD_DIR = TMP_ROOT;

// ---------------------------------------------------------------------------
describe("chat storage", () => {
  afterAll(async () => {
    await deleteSessionFiles("session-a");
    await deleteSessionFiles("session-b");
  });

  it("round-trips a saved file and returns a session-scoped relative path", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const rel = await saveChatFile("session-a", "photo.png", bytes);
    expect(rel.startsWith("session-a/")).toBe(true);
    const read = await readChatFile(rel);
    expect(Array.from(read)).toEqual([1, 2, 3, 4, 5]);
  });

  it("deleteSessionFiles removes the session folder", async () => {
    await saveChatFile("session-b", "a.txt", new Uint8Array([9]));
    await deleteSessionFiles("session-b");
    await expect(stat(path.join(TMP_ROOT, "session-b"))).rejects.toBeDefined();
  });

  it("resolveStoredPath rejects traversal outside the upload root", () => {
    expect(() => resolveStoredPath("../../etc/passwd")).toThrow();
  });

  it("safeFileName never leaks the original name and keeps a safe extension", () => {
    const name = safeFileName("../../weird name!.PNG");
    expect(name).not.toContain("weird");
    expect(name.endsWith(".PNG")).toBe(true);
    expect(name).not.toContain("/");
  });

  it("attachmentTypeFromMime buckets by prefix, defaulting to document", () => {
    expect(attachmentTypeFromMime("image/png")).toBe("image");
    expect(attachmentTypeFromMime("video/mp4")).toBe("video");
    expect(attachmentTypeFromMime("audio/mpeg")).toBe("audio");
    expect(attachmentTypeFromMime("application/pdf")).toBe("document");
  });

  it("clientAttachmentsEnabled is default-on; only \"false\" disables", () => {
    delete process.env.NEXT_PUBLIC_LIVE_CHAT_ATTACHMENTS_ENABLED;
    expect(clientAttachmentsEnabled()).toBe(true);
    process.env.NEXT_PUBLIC_LIVE_CHAT_ATTACHMENTS_ENABLED = "false";
    expect(clientAttachmentsEnabled()).toBe(false);
    process.env.NEXT_PUBLIC_LIVE_CHAT_ATTACHMENTS_ENABLED = "true";
    expect(clientAttachmentsEnabled()).toBe(true);
    delete process.env.NEXT_PUBLIC_LIVE_CHAT_ATTACHMENTS_ENABLED;
  });

  it("maxUploadBytes honours CHAT_MAX_UPLOAD_MB", () => {
    process.env.CHAT_MAX_UPLOAD_MB = "5";
    expect(maxUploadBytes()).toBe(5 * 1024 * 1024);
    delete process.env.CHAT_MAX_UPLOAD_MB;
    expect(maxUploadBytes()).toBe(20 * 1024 * 1024);
  });
});

// ---------------------------------------------------------------------------
describe("telegram pure helpers", () => {
  it("escapeHtml encodes the HTML-significant characters", () => {
    expect(escapeHtml('<b>&"a"</b>')).toBe("&lt;b&gt;&amp;&quot;a&quot;&lt;/b&gt;");
  });

  it("extractUpdateText prefers message, falls back to edited_message", () => {
    expect(extractUpdateText({ message: { message_id: 1, text: "hi" } }).text).toBe("hi");
    expect(extractUpdateText({ edited_message: { message_id: 2, text: "yo" } }).text).toBe("yo");
    expect(extractUpdateText({}).message).toBeUndefined();
  });

  it("extractThreadId reads the direct or replied thread id", () => {
    expect(extractThreadId({ message_id: 1, message_thread_id: 7 } as TelegramMessage)).toBe(7);
    expect(
      extractThreadId({ message_id: 1, reply_to_message: { message_id: 0, message_thread_id: 9 } } as TelegramMessage),
    ).toBe(9);
  });

  it("isBotMessage reflects the from.is_bot flag", () => {
    expect(isBotMessage({ message_id: 1, from: { id: 1, is_bot: true } } as TelegramMessage)).toBe(true);
    expect(isBotMessage({ message_id: 1, from: { id: 1 } } as TelegramMessage)).toBe(false);
  });

  it("formatVisitorContext embeds escaped context + the token", () => {
    const out = formatVisitorContext("hello <there>", {
      name: "Al & Bo",
      email: "a@b.co",
      visitorId: "vid-123",
    });
    expect(out).toContain("Al &amp; Bo");
    expect(out).toContain("vid-123");
    expect(out).toContain("hello &lt;there&gt;");
  });

  it("validateWebhookSecret compares to the env secret (open when unset)", () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    expect(validateWebhookSecret("anything")).toBe(true);
    process.env.TELEGRAM_WEBHOOK_SECRET = "s3cr3t";
    expect(validateWebhookSecret("s3cr3t")).toBe(true);
    expect(validateWebhookSecret("nope")).toBe(false);
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
  });

  it("extractMedia picks the LARGEST photo size", () => {
    const media = extractMedia({
      message_id: 1,
      caption: "pic",
      photo: [
        { file_id: "small", file_unique_id: "s", file_size: 100 },
        { file_id: "large", file_unique_id: "l", file_size: 900 },
        { file_id: "mid", file_unique_id: "m", file_size: 400 },
      ],
    } as TelegramMessage);
    expect(media?.type).toBe("image");
    expect(media?.fileId).toBe("large");
    expect(media?.caption).toBe("pic");
    expect(media?.mime).toBe("image/jpeg");
  });

  it("extractMedia preserves a document's name + mime, and returns null for plain text", () => {
    const doc = extractMedia({
      message_id: 2,
      document: { file_id: "d1", file_unique_id: "d", file_name: "report.pdf", mime_type: "application/pdf", file_size: 10 },
    } as TelegramMessage);
    expect(doc?.type).toBe("document");
    expect(doc?.fileName).toBe("report.pdf");
    expect(doc?.mime).toBe("application/pdf");
    expect(extractMedia({ message_id: 3, text: "just text" } as TelegramMessage)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("telegram media transport (fetch mocked)", () => {
  const realFetch = globalThis.fetch;
  let calls: { url: string; init?: RequestInit }[];

  const jsonResponse = (obj: unknown) =>
    new Response(JSON.stringify(obj), { headers: { "content-type": "application/json" } });

  beforeEach(() => {
    calls = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, init });
      if (u.includes("/getFile")) {
        return jsonResponse({ ok: true, result: { file_id: "F", file_unique_id: "U", file_path: "photos/file_1.jpg" } });
      }
      if (u.includes("/file/bot")) {
        return new Response(new Uint8Array([7, 8, 9]), { status: 200 });
      }
      if (u.includes("/sendPhoto")) {
        return jsonResponse({ ok: true, result: { message_id: 555 } });
      }
      if (u.includes("/sendDocument")) {
        return jsonResponse({ ok: false, description: "Bad Request: file too big", error_code: 400 });
      }
      return jsonResponse({ ok: false, description: "unexpected call" });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("getTelegramFile resolves a file_path via the API host", async () => {
    const file = await getTelegramFile("F");
    expect(file.file_path).toBe("photos/file_1.jpg");
    expect(calls[0].url).toContain("/bottest-bot-token/getFile");
  });

  it("downloadTelegramFile fetches raw bytes from the FILE host", async () => {
    const buf = await downloadTelegramFile("photos/file_1.jpg");
    expect(Array.from(new Uint8Array(buf))).toEqual([7, 8, 9]);
    expect(calls[0].url).toContain("/file/bottest-bot-token/photos/file_1.jpg");
  });

  it("sendMediaToTopic posts multipart to sendPhoto for an image", async () => {
    const res = await sendMediaToTopic(42, {
      type: "image",
      data: new Uint8Array([1, 2]),
      fileName: "x.png",
      mime: "image/png",
      caption: "hi",
    });
    expect(res.message_id).toBe(555);
    const call = calls[0];
    expect(call.url).toContain("/sendPhoto");
    expect(call.init?.body).toBeInstanceOf(FormData);
  });

  it("sendMediaToTopic surfaces a Telegram ok:false as ChatTelegramError", async () => {
    await expect(
      sendMediaToTopic(42, { type: "document", data: new Uint8Array([1]), fileName: "b.bin", mime: "application/octet-stream" }),
    ).rejects.toMatchObject({ code: "TELEGRAM_API_ERROR" });
  });
});

// ---------------------------------------------------------------------------
describe("telegram webhook registration (fetch mocked)", () => {
  const realFetch = globalThis.fetch;
  const jsonResponse = (obj: unknown) =>
    new Response(JSON.stringify(obj), { headers: { "content-type": "application/json" } });

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.TELEGRAM_WEBHOOK_URL;
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
  });

  it("honors a 429 retry_after then succeeds (setWebhook retries)", async () => {
    let n = 0;
    const seen: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      seen.push(u);
      if (u.includes("/setWebhook")) {
        n += 1;
        if (n === 1) {
          return jsonResponse({ ok: false, error_code: 429, description: "Too Many Requests: retry after 1", parameters: { retry_after: 1 } });
        }
        return jsonResponse({ ok: true, result: true });
      }
      return jsonResponse({ ok: false, description: "unexpected" });
    }) as typeof fetch;

    await setTelegramWebhook("https://example.com/hook", "s3cr3t", ["message"]);
    expect(seen.filter((u) => u.includes("/setWebhook")).length).toBe(2);
  }, 10_000);

  it("ensureTelegramWebhook skips setWebhook when the live webhook already matches", async () => {
    process.env.TELEGRAM_WEBHOOK_URL = "https://example.com/hook";
    process.env.TELEGRAM_WEBHOOK_SECRET = "s3cr3t";
    const seen: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      seen.push(u);
      if (u.includes("/getWebhookInfo")) {
        return jsonResponse({ ok: true, result: { url: "https://example.com/hook", allowed_updates: ["message", "edited_message"] } });
      }
      if (u.includes("/setWebhook")) {
        return jsonResponse({ ok: true, result: true });
      }
      return jsonResponse({ ok: false, description: "unexpected" });
    }) as typeof fetch;

    // CACHE_DRIVER=memory in this file -> waitForReadyRedis returns null -> direct path.
    await ensureTelegramWebhook();
    expect(seen.some((u) => u.includes("/getWebhookInfo"))).toBe(true);
    expect(seen.some((u) => u.includes("/setWebhook"))).toBe(false);
  });

  it("ensureTelegramWebhook calls setWebhook when the live url differs", async () => {
    process.env.TELEGRAM_WEBHOOK_URL = "https://example.com/hook";
    process.env.TELEGRAM_WEBHOOK_SECRET = "s3cr3t";
    const seen: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      seen.push(u);
      if (u.includes("/getWebhookInfo")) {
        return jsonResponse({ ok: true, result: { url: "https://old.example.com/hook", allowed_updates: ["message"] } });
      }
      if (u.includes("/setWebhook")) {
        return jsonResponse({ ok: true, result: true });
      }
      return jsonResponse({ ok: false, description: "unexpected" });
    }) as typeof fetch;

    await ensureTelegramWebhook();
    expect(seen.some((u) => u.includes("/setWebhook"))).toBe(true);
  });

  it("getTelegramWebhookInfo returns the current webhook url", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ ok: true, result: { url: "https://example.com/hook", allowed_updates: ["message"] } })) as typeof fetch;
    const info = await getTelegramWebhookInfo();
    expect(info.url).toBe("https://example.com/hook");
  });
});

// ---------------------------------------------------------------------------
describe("chat pubsub (in-memory bus)", () => {
  it("namespaces the channel by the redis key prefix", () => {
    expect(chatChannel("abc")).toContain("chat:abc");
  });

  it("delivers published events to subscribers and stops after unsubscribe", async () => {
    const received: ChatEvent[] = [];
    const unsubscribe = await subscribeChatEvents("sess-1", (e) => received.push(e));

    await publishChatEvent("sess-1", { type: "message", sessionId: "sess-1", message: { id: "m1" } as any });
    await publishChatEvent("sess-2", { type: "status", sessionId: "sess-2", status: "closed" }); // other session

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("message");

    unsubscribe();
    await publishChatEvent("sess-1", { type: "status", sessionId: "sess-1", status: "closed" });
    expect(received).toHaveLength(1); // no delivery after unsubscribe
  });
});

// ---------------------------------------------------------------------------
describe("chat DTO mappers", () => {
  const now = new Date("2024-01-01T12:00:00.000Z");

  it("toMessageDto exposes attachment METADATA (never the path) when present", () => {
    const dto = toMessageDto({
      id: "m1",
      chatSessionId: "s1",
      direction: "support",
      text: "see file",
      telegramMessageId: 1,
      errorText: null,
      attachmentType: "image",
      attachmentName: "pic.png",
      attachmentMime: "image/png",
      attachmentSize: 1234,
      attachmentPath: "s1/secret-uuid.png",
      createdAt: now,
    } as any);
    expect(dto.attachment).toEqual({ type: "image", name: "pic.png", mime: "image/png", size: 1234 });
    expect(JSON.stringify(dto)).not.toContain("secret-uuid");
    expect(dto.createdAt).toBe("2024-01-01T12:00:00.000Z");
  });

  it("toMessageDto omits attachment/errorText for a plain text message", () => {
    const dto = toMessageDto({
      id: "m2",
      chatSessionId: "s1",
      direction: "visitor",
      text: "hello",
      telegramMessageId: null,
      errorText: null,
      attachmentType: null,
      attachmentName: null,
      attachmentMime: null,
      attachmentSize: null,
      attachmentPath: null,
      createdAt: now,
    } as any);
    expect(dto.attachment).toBeUndefined();
    expect(dto.errorText).toBeUndefined();
    expect(dto.text).toBe("hello");
  });

  it("toSessionDto surfaces public fields only", () => {
    const dto = toSessionDto({
      id: "s1",
      visitorId: "vid",
      name: "Al",
      email: "a@b.co",
      ip: "1.2.3.4",
      telegramChatId: "-100",
      telegramThreadId: 5,
      status: "open",
      createdAt: now,
      updatedAt: now,
    } as any);
    expect(dto).toEqual({
      id: "s1",
      visitorId: "vid",
      name: "Al",
      email: "a@b.co",
      status: "open",
      createdAt: "2024-01-01T12:00:00.000Z",
      updatedAt: "2024-01-01T12:00:00.000Z",
    });
    expect(JSON.stringify(dto)).not.toContain("1.2.3.4"); // ip is never exposed
  });
});
