/**
 * Lazy access to the shared ioredis singleton for the chat subsystem.
 *
 * Importing `@/lib/redis` eagerly opens a connection at module load, which would
 * hang unit tests that only exercise the pure/in-memory paths. Every chat module
 * that needs Redis (pubsub, telegram webhook registration, the group registry,
 * the SSE stream) goes through here instead: the connection is only touched when
 * Redis is actually enabled AND ready, and the module is dynamically imported so
 * a `CACHE_DRIVER=memory` test never loads it.
 */
import { env } from "@/lib/env";

/** The shared client when Redis is enabled AND connected; otherwise null. */
export async function getReadyRedis(): Promise<import("ioredis").default | null> {
  if (env.CACHE_DRIVER === "memory") return null;
  try {
    const { redis } = await import("@/lib/redis");
    return redis.status === "ready" ? redis : null;
  } catch {
    return null;
  }
}

/** True when the shared Redis client is enabled and ready (cross-worker capable). */
export async function isRedisReady(): Promise<boolean> {
  return (await getReadyRedis()) !== null;
}
