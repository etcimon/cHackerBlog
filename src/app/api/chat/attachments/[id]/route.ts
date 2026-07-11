/**
 * Authenticated attachment byte serving (GET). The caller's ?visitorId must
 * equal the owning session's visitorId (the per-conversation shared secret),
 * which prevents enumerating other conversations' files by guessing message ids.
 * Rich media is served inline; documents (or ?download=1) force a download.
 */
import { fail, Errors, AppError } from "@/lib/errors";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { getChatMessageWithSession } from "@/lib/chat/db";
import { readChatFile } from "@/lib/chat/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Strip anything that could break the Content-Disposition header. */
function sanitizeFilename(name: string | null | undefined): string {
  return (name || "file").replace(/[^A-Za-z0-9._ -]/g, "_");
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ip = getClientIp(req.headers);
  const rl = await rateLimit(ip, "chat.attachment", { max: 60, windowSeconds: 60 });
  if (!rl.allowed) return fail(Errors.rateLimited("Too many requests"));

  const { id } = await params;
  const url = new URL(req.url);
  const visitorId = url.searchParams.get("visitorId");
  const forceDownload = url.searchParams.get("download") === "1";
  if (!visitorId) return fail(new AppError("visitorId is required", 422, "VALIDATION_ERROR"));

  const message = await getChatMessageWithSession(id);
  if (!message || !message.attachmentPath) return fail(Errors.notFound("Attachment not found"));
  if (message.chatSession.visitorId !== visitorId) {
    return fail(Errors.forbidden("Not authorized for this attachment"));
  }

  let bytes: Buffer;
  try {
    bytes = await readChatFile(message.attachmentPath);
  } catch {
    return fail(Errors.notFound("Attachment file is no longer available."));
  }

  const disposition = forceDownload || message.attachmentType === "document" ? "attachment" : "inline";
  const body = new Uint8Array(bytes);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": message.attachmentMime ?? "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `${disposition}; filename="${sanitizeFilename(message.attachmentName)}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
