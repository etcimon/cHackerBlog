/**
 * SSE downstream (GET). Streams a full history snapshot then live message/status
 * events for a visitor's session. Subscribes to the pub/sub bus BEFORE the first
 * history read (buffering any events that arrive during the race) and falls back
 * to DB polling when the bus disconnects.
 *
 * The `no-transform` + `X-Accel-Buffering: no` headers are required so proxies
 * (and Next itself) never buffer/compress the stream — otherwise live frames are
 * held until the stream ends and the browser never sees real-time replies.
 *
 * CLUSTERING: the in-memory pub/sub bus is PROCESS-LOCAL and cannot cross PM2
 * workers. The webhook publishes on whichever worker Telegram hits; this SSE
 * stream may live on a different worker. Redis pub/sub is the only real-time
 * cross-worker transport; when it is unavailable, DB polling is the durable
 * fallback (messages AND session status are persisted). subscribeChatEvents
 * returns a TRUTHY unsubscribe even for the in-memory bus, so we must key polling
 * on whether the transport is actually cross-worker-capable (Redis ready), NOT
 * merely on whether an unsubscribe exists — otherwise cross-worker replies are
 * silently dropped.
 */
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import {
  findChatSessionByVisitorId,
  findChatSessionById,
  listChatMessages,
  toMessageDto,
} from "@/lib/chat/db";
import { subscribeChatEvents } from "@/lib/chat/pubsub";
import { isRedisReady } from "@/lib/chat/redis-lazy";
import type { ChatEvent } from "@/lib/chat/types";
import { createLogger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POLL_INTERVAL_MS = 3000;
const KEEPALIVE_INTERVAL_MS = 15000;

const log = createLogger("api:chat:stream");

export async function GET(req: Request) {
  const ip = getClientIp(req.headers);
  const rl = await rateLimit(ip, "chat.stream", { max: 60, windowSeconds: 60 });
  if (!rl.allowed) return new Response("rate limited", { status: 429 });

  const url = new URL(req.url);
  const visitorId = url.searchParams.get("visitorId");
  if (!visitorId) return new Response("visitorId required", { status: 400 });

  const session = await findChatSessionByVisitorId(visitorId);
  if (!session) {
    return new Response(":no session\n\n", {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  const encoder = new TextEncoder();
  let closed = false;
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let keepaliveInterval: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;

  const cleanup = () => {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    if (keepaliveInterval) {
      clearInterval(keepaliveInterval);
      keepaliveInterval = null;
    }
    if (unsubscribe) {
      try {
        unsubscribe();
      } catch (err) {
        log.error("cleanup unsubscribe error", (err as Error).message);
      }
      unsubscribe = null;
    }
    closed = true;
  };

  const signal = (req as unknown as { signal?: AbortSignal }).signal;
  signal?.addEventListener("abort", cleanup);

  const stream = new ReadableStream({
    async start(controller) {
      let lastMessageCount = 0;
      const historyMessageIds = new Set<string>();
      let historyLoaded = false;
      const pendingEvents: ChatEvent[] = [];

      const enqueue = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // swallow post-close writes
        }
      };
      const sendMessageFrame = (m: ReturnType<typeof toMessageDto>) => {
        historyMessageIds.add(m.id);
        lastMessageCount++;
        enqueue(`event: message\ndata: ${JSON.stringify(m)}\n\n`);
      };
      let closedStatusSent = false;
      const sendStatus = (s: { sessionId: string; status: string }) => {
        if (s.status === "closed") closedStatusSent = true;
        enqueue(`event: status\ndata: ${JSON.stringify(s)}\n\n`);
      };

      const sendHistory = async () => {
        const msgs = (await listChatMessages(session.id)).map(toMessageDto);
        if (msgs.length > lastMessageCount) {
          historyMessageIds.clear();
          for (const m of msgs) historyMessageIds.add(m.id);
          lastMessageCount = msgs.length;
          enqueue(`event: history\ndata: ${JSON.stringify({ session: { id: session.id, visitorId, status: session.status }, messages: msgs })}\n\n`);
        }
      };

      // Cross-worker close detection for the polling path: a /close or /end on
      // another worker only persists status + publishes on the Redis bus, so when
      // we are polling (no durable bus) we must poll the row status too.
      const checkSessionStatus = async () => {
        if (closedStatusSent) return;
        const fresh = await findChatSessionById(session.id);
        if (fresh?.status === "closed") sendStatus({ sessionId: session.id, status: "closed" });
      };

      const handleEvent = (e: ChatEvent) => {
        if (e.type === "message") {
          if (historyMessageIds.has(e.message.id)) return;
          sendMessageFrame(e.message);
        } else if (e.type === "status") {
          sendStatus({ sessionId: e.sessionId, status: e.status });
        }
      };
      const eventHandler = (e: ChatEvent) => {
        if (!historyLoaded) {
          pendingEvents.push(e);
          return;
        }
        handleEvent(e);
      };

      const startPolling = () => {
        if (!pollInterval) {
          pollInterval = setInterval(() => {
            void Promise.all([sendHistory(), checkSessionStatus()]).catch(() => {});
          }, POLL_INTERVAL_MS);
        }
      };
      const stopPolling = () => {
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
      };

      enqueue(":ok\n\n");

      unsubscribe = await subscribeChatEvents(session.id, eventHandler, {
        onDisconnect: startPolling,
        onReconnect: stopPolling,
      });
      // Poll unless the transport is durably cross-worker (a real, ready Redis
      // subscription). The in-memory bus returns a truthy unsubscribe but cannot
      // see events published on another worker, so it MUST keep polling.
      const durableTransport = Boolean(unsubscribe) && (await isRedisReady());
      if (!durableTransport) startPolling();

      await sendHistory();
      historyLoaded = true;
      for (const e of pendingEvents) handleEvent(e);
      pendingEvents.length = 0;

      keepaliveInterval = setInterval(() => enqueue(":keepalive\n\n"), KEEPALIVE_INTERVAL_MS);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
