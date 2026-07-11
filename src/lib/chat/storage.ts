/**
 * Per-session on-disk attachment store: the single source of truth for WHERE
 * chat attachment bytes live and HOW they are named, plus the small config
 * helpers the routes read. Node fs/promises only (server runtime).
 *
 * Everything is keyed on the STABLE ChatSession.id so cleanup is deterministic
 * (the visitorId rotates and must NOT be used for paths). A traversal guard
 * (resolveStoredPath) fronts every read/serve so a crafted attachmentPath can
 * never escape the upload root.
 *
 * NOTE: config helpers read process.env at call time (never cached) so a value
 * can be changed between environments / mutated by tests without a rebuild.
 */
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ChatAttachmentType } from "@/lib/chat/types";

/** Absolute path of the upload root (CHAT_UPLOAD_DIR relative to cwd). */
export function chatUploadRoot(): string {
  return path.resolve(process.cwd(), process.env.CHAT_UPLOAD_DIR || "chat-uploads");
}

/** Maximum single-upload size in bytes (CHAT_MAX_UPLOAD_MB, default 20). */
export function maxUploadBytes(): number {
  const mb = Number(process.env.CHAT_MAX_UPLOAD_MB || "20");
  const safe = Number.isFinite(mb) && mb > 0 ? mb : 20;
  return safe * 1024 * 1024;
}

/**
 * DEFAULT-ON attachment gate. Only the literal string "false" disables uploads.
 * Read on BOTH client and server from the same NEXT_PUBLIC_* var so the two
 * agree; the server re-checks it (see the send route) so a forged client cannot
 * bypass a disabled state.
 */
export function clientAttachmentsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_LIVE_CHAT_ATTACHMENTS_ENABLED !== "false";
}

/** Coarse MIME -> attachment kind bucket (storage + rendering + send method). */
export function attachmentTypeFromMime(mime: string): ChatAttachmentType {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  return "document";
}

/**
 * Reduce any value to a single safe path component: basename it, replace every
 * char outside [A-Za-z0-9._-] with "_", and reject "" / "." / "..".
 */
function sanitizeSegment(value: string): string {
  const base = path.basename(value || "");
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_");
  if (!cleaned || cleaned === "." || cleaned === "..") {
    throw new Error(`Unsafe path segment: ${value}`);
  }
  return cleaned;
}

/** Absolute directory for a session's files. */
export function sessionDir(sessionId: string): string {
  return path.join(chatUploadRoot(), sanitizeSegment(sessionId));
}

/**
 * Build a safe, UNIQUE on-disk file name: `${randomUUID()}${ext}` where ext is
 * the sanitized (<=16 char, [A-Za-z0-9.] only) extension of the original name.
 * The random name means the client filename never influences the path (the
 * display name is kept separately in ChatMessage.attachmentName).
 */
export function safeFileName(originalName: string): string {
  const rawExt = path.extname(originalName || "");
  const safeExt = rawExt.replace(/[^A-Za-z0-9.]/g, "").slice(0, 16);
  return `${randomUUID()}${safeExt}`;
}

/**
 * TRAVERSAL GUARD. Resolve a stored RELATIVE path back to an absolute path and
 * assert it stays within chatUploadRoot() (equal to root OR under root + sep);
 * throw otherwise. Every read/serve goes through this.
 */
export function resolveStoredPath(relative: string): string {
  const root = chatUploadRoot();
  const abs = path.resolve(root, relative);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error("Resolved attachment path escapes the upload root");
  }
  return abs;
}

/**
 * mkdir -p the sessionDir, write bytes to safeFileName(originalName), and
 * return the storage-root-RELATIVE path with FORWARD SLASHES
 * ("<sessionId>/<uuid.ext>") — that string is stored in ChatMessage.attachmentPath.
 */
export async function saveChatFile(
  sessionId: string,
  originalName: string,
  data: Uint8Array,
): Promise<string> {
  const dir = sessionDir(sessionId);
  await mkdir(dir, { recursive: true });
  const fileName = safeFileName(originalName);
  await writeFile(path.join(dir, fileName), data);
  return `${sanitizeSegment(sessionId)}/${fileName}`;
}

/** Read a stored file's bytes (through the traversal guard). */
export async function readChatFile(relativePath: string): Promise<Buffer> {
  return readFile(resolveStoredPath(relativePath));
}

/**
 * Best-effort recursive delete of a whole session's folder; swallows ENOENT so
 * calling it twice / on an empty session is harmless and never throws.
 */
export async function deleteSessionFiles(sessionId: string): Promise<void> {
  try {
    await rm(sessionDir(sessionId), { recursive: true, force: true });
  } catch {
    // Never throw from cleanup.
  }
}
