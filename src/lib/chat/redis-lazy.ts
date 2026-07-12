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

/**
 * Wait (bounded) for the shared Redis client to reach the `ready` state, then
 * return it; resolves `null` if Redis is disabled (`CACHE_DRIVER=memory`), the
 * module fails to load, or it never becomes ready within `timeoutMs`.
 *
 * The eager (`lazyConnect:false`) client is still `connecting` for the first few
 * hundred ms after boot, so callers that run at startup (e.g. the Telegram
 * webhook registration) would otherwise see `status !== "ready"` and wrongly
 * conclude Redis is absent. Waiting here lets those callers use the real,
 * cross-worker-coordinated path when Redis is genuinely available.
 */
export async function waitForReadyRedis(
  timeoutMs = 5_000,
): Promise<import("ioredis").default | null> {
  if (env.CACHE_DRIVER === "memory") return null;
  let redis: import("ioredis").default;
  try {
    ({ redis } = await import("@/lib/redis"));
  } catch {
    return null;
  }
  if (redis.status === "ready") return redis;
  // A client that has been explicitly closed will never become ready.
  if (redis.status === "end") return null;

  return await new Promise((resolve) => {
    let settled = false;
    const finish = (value: import("ioredis").default | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      redis.removeListener("ready", onReady);
      resolve(value);
    };
    const onReady = () => finish(redis);
    const timer = setTimeout(() => finish(redis.status === "ready" ? redis : null), timeoutMs);
    redis.once("ready", onReady);
    // Guard against the client becoming ready between the check and the listener.
    if (redis.status === "ready") finish(redis);
  });
}
