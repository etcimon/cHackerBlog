/**
 * Public widget config (GET). Returns `{ enabled }` combining the client env
 * flag with a live availability check (canDispatch): the widget can then hide
 * itself when NO support group is currently able to receive a new chat (registry
 * initialized but empty / all paused). Returns a PLAIN JSON body (not the ok()
 * envelope) so the client can read `data.enabled` directly. Fails open to the
 * env flag if the availability probe throws.
 */
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { canDispatch } from "@/lib/chat/registry";
import { createLogger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("api:chat:config");

export async function GET(req: Request) {
  const ip = getClientIp(req.headers);
  const rl = await rateLimit(ip, "chat.config", { max: 60, windowSeconds: 60 });
  if (!rl.allowed) return new Response("rate limited", { status: 429 });

  const envEnabled = process.env.NEXT_PUBLIC_LIVE_CHAT_ENABLED !== "false";
  let enabled = envEnabled;
  try {
    enabled = envEnabled && (await canDispatch());
  } catch (err) {
    log.error("canDispatch failed:", (err as Error).message);
  }
  return Response.json({ enabled });
}
