/**
 * Visitor-initiated close (POST). Marks the session closed, deletes its stored
 * attachments, and broadcasts status:closed so other tabs/workers tear down
 * their SSE streams. Idempotent: an already-closed session returns unchanged
 * with no re-broadcast.
 */
import { z } from "zod";
import { ok, fail, Errors } from "@/lib/errors";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import {
  findChatSessionByVisitorId,
  closeChatSessionByVisitorId,
  toSessionDto,
} from "@/lib/chat/db";
import { deleteSessionFiles } from "@/lib/chat/storage";
import { publishChatEvent } from "@/lib/chat/pubsub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const closeSchema = z.object({ visitorId: z.string().min(1).max(100) });

export async function POST(req: Request) {
  const ip = getClientIp(req.headers);
  const rl = await rateLimit(ip, "chat.close", { max: 30, windowSeconds: 60 });
  if (!rl.allowed) return fail(Errors.rateLimited("Too many requests"));

  try {
    const { visitorId } = closeSchema.parse(await req.json());
    const session = await findChatSessionByVisitorId(visitorId);
    if (!session) return fail(Errors.notFound("Chat session not found"));
    if (session.status === "closed") return ok({ session: toSessionDto(session) });

    const updated = await closeChatSessionByVisitorId(visitorId);
    await deleteSessionFiles(updated.id);
    await publishChatEvent(updated.id, {
      type: "status",
      sessionId: updated.id,
      status: "closed",
    });
    return ok({ session: toSessionDto(updated) });
  } catch (err) {
    return fail(err);
  }
}
