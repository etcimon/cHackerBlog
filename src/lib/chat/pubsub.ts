/**
 * Cross-worker fanout for chat events. Uses Redis pub/sub when available and a
 * process-local in-memory bus otherwise (single-worker dev / tests / Redis
 * outage). The stream route subscribes per session; mutation routes publish.
 *
 * A subscribed ioredis connection cannot issue normal commands, so each
 * subscriber gets its OWN dedicated connection. On reconnect we explicitly
 * re-subscribe to every tracked channel (ioredis autoResubscribe can miss
 * channels subscribed before the first "ready"), which is what makes Telegram
 * replies reliably reach the SSE stream after any blip. publish() logs the
 * subscriber count: `subscriberCount: 0` is the canonical symptom of "message
 * published but nobody was listening yet".
 */
import Redis from "ioredis";
import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import type { ChatEvent } from "@/lib/chat/types";

const log = createLogger("chat:pubsub");

/** One channel per session (namespaced by the shared key prefix). */
export function chatChannel(sessionId: string): string {
  return `${env.REDIS_KEY_PREFIX}chat:${sessionId}`;
}

export type ChatEventHandler = (event: ChatEvent) => void;

export interface SubscribeOptions {
  onDisconnect?: () => void;
  onReconnect?: () => void;
}

/**
 * Lazily import the shared Redis singleton and return it only when it is ready.
 * Lazy so that importing this module (e.g. for the pure in-memory bus in tests)
 * never opens a Redis connection.
 */
async function getReadyRedis(): Promise<import("ioredis").default | null> {
  if (env.CACHE_DRIVER === "memory") return null;
  try {
    const { redis } = await import("@/lib/redis");
    return redis.status === "ready" ? redis : null;
  } catch {
    return null;
  }
}

// --- in-memory bus ----------------------------------------------------------

const memoryHandlers = new Map<string, Set<ChatEventHandler>>();

const memory = {
  async subscribe(sessionId: string, handler: ChatEventHandler): Promise<() => void> {
    let set = memoryHandlers.get(sessionId);
    if (!set) {
      set = new Set();
      memoryHandlers.set(sessionId, set);
    }
    set.add(handler);
    return () => {
      const s = memoryHandlers.get(sessionId);
      if (!s) return;
      s.delete(handler);
      if (s.size === 0) memoryHandlers.delete(sessionId);
    };
  },
  async publish(sessionId: string, event: ChatEvent): Promise<void> {
    const set = memoryHandlers.get(sessionId);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(event);
      } catch (err) {
        log.error("memory handler error:", (err as Error).message);
      }
    }
  },
};

// --- redis subscriber -------------------------------------------------------

class RedisChatPubSub {
  private connected = false;
  private handlers = new Map<string, Set<ChatEventHandler>>();

  constructor(
    private subscriber: Redis,
    private options?: SubscribeOptions,
  ) {
    this.subscriber.on("message", this.onMessage);
    this.subscriber.on("ready", this.onReady);
    this.subscriber.on("close", this.onDisconnect);
    this.subscriber.on("end", this.onDisconnect);
    this.subscriber.on("error", this.onDisconnect);
  }

  private onMessage = (channel: string, payload: string) => {
    const sessionId = channel.slice(chatChannel("").length);
    const set = this.handlers.get(sessionId);
    if (!set || set.size === 0) {
      log.warn("no handlers for session", { sessionId });
      return;
    }
    let event: ChatEvent;
    try {
      event = JSON.parse(payload) as ChatEvent;
    } catch {
      return;
    }
    for (const handler of set) {
      try {
        handler(event);
      } catch (err) {
        log.error("redis handler error:", (err as Error).message);
      }
    }
  };

  private onReady = () => {
    this.connected = true;
    this.options?.onReconnect?.();
    // Re-subscribe to every tracked channel (autoResubscribe edge case).
    const channels = [...this.handlers.keys()].map(chatChannel);
    if (channels.length) this.subscriber.subscribe(...channels).catch(() => {});
  };

  private onDisconnect = () => {
    if (!this.connected) return; // edge-triggered
    this.connected = false;
    this.options?.onDisconnect?.();
  };

  async subscribe(sessionId: string, handler: ChatEventHandler): Promise<() => void> {
    let set = this.handlers.get(sessionId);
    if (!set) {
      set = new Set();
      this.handlers.set(sessionId, set);
      await this.subscriber.subscribe(chatChannel(sessionId));
    }
    set.add(handler);
    return () => {
      const s = this.handlers.get(sessionId);
      if (!s) return;
      s.delete(handler);
      if (s.size === 0) {
        this.handlers.delete(sessionId);
        this.subscriber.unsubscribe(chatChannel(sessionId)).catch(() => {});
      }
    };
  }

  close(): void {
    this.subscriber.removeAllListeners();
    this.subscriber.disconnect();
  }
}

// --- public API -------------------------------------------------------------

/**
 * Publish an event. Reuses the shared client (publishing is connection-cheap)
 * and falls back to the in-memory bus if Redis is down.
 */
export async function publishChatEvent(sessionId: string, event: ChatEvent): Promise<void> {
  const redis = await getReadyRedis();
  if (redis) {
    try {
      const count = await redis.publish(chatChannel(sessionId), JSON.stringify(event));
      log.info("redis chat publish", { sessionId, subscriberCount: count });
      return;
    } catch (err) {
      log.warn("redis publish fell back to memory:", (err as Error).message);
    }
  }
  await memory.publish(sessionId, event);
}

/**
 * Subscribe to a session's events. Creates a DEDICATED ioredis subscriber (a
 * subscribed connection cannot issue normal commands) or falls back to the
 * in-memory bus. Returns an unsubscribe that also closes that connection.
 */
export async function subscribeChatEvents(
  sessionId: string,
  handler: ChatEventHandler,
  options?: SubscribeOptions,
): Promise<() => void> {
  if (await getReadyRedis()) {
    try {
      const subscriber = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
      const sub = new RedisChatPubSub(subscriber, options);
      const unsub = await sub.subscribe(sessionId, handler);
      return () => {
        unsub();
        sub.close();
      };
    } catch (err) {
      log.warn("redis subscribe fell back to memory:", (err as Error).message);
    }
  }
  return memory.subscribe(sessionId, handler);
}
