/**
 * Unified key/value backend used by cache.ts and rate-limit.ts. Chooses between
 * Redis and the in-memory store (local-cache.ts) based on CACHE_DRIVER:
 *
 *   redis  -> always Redis.
 *   memory -> always in-memory (Redis is never imported/connected; ideal for
 *             tests and single-process deployments without Redis).
 *   auto   -> Redis when the connection is ready, otherwise transparently fall
 *             back to in-memory (the default; survives Redis outages).
 *
 * Logical keys are passed un-prefixed; ioredis applies REDIS_KEY_PREFIX on the
 * Redis path, while the memory store uses the logical key directly. Bulk
 * prefix deletes are handled per-backend so callers stay agnostic.
 */
import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import { MemoryStore } from "@/lib/local-cache";

const log = createLogger("kv");

/** Shared in-memory store (fallback + memory-driver backend). */
export const memory = new MemoryStore();

type RedisClient = import("ioredis").default;
let redisPromise: Promise<RedisClient | null> | null = null;

/**
 * Lazily import the Redis singleton (so the `memory` driver never connects).
 * Returns null when Redis should not / cannot be used right now.
 */
async function getRedis(): Promise<RedisClient | null> {
  if (env.CACHE_DRIVER === "memory") return null;
  if (!redisPromise) {
    redisPromise = import("@/lib/redis")
      .then((m) => m.redis)
      .catch((e) => {
        log.error("failed to load redis client:", (e as Error).message);
        return null;
      });
  }
  const r = await redisPromise;
  if (!r) return null;
  // In auto mode, only use Redis once the connection is actually ready.
  if (env.CACHE_DRIVER === "auto" && r.status !== "ready") return null;
  return r;
}

/** Whether the current operation will use the in-memory backend. */
export async function usingMemory(): Promise<boolean> {
  return (await getRedis()) === null;
}

export async function kvGet(key: string): Promise<string | null> {
  const r = await getRedis();
  if (r) {
    try {
      return await r.get(key);
    } catch (e) {
      log.warn("get fell back to memory:", (e as Error).message);
    }
  }
  return memory.get(key);
}

export async function kvSet(key: string, value: string, ttlSeconds?: number): Promise<void> {
  const r = await getRedis();
  if (r) {
    try {
      if (ttlSeconds) await r.set(key, value, "EX", ttlSeconds);
      else await r.set(key, value);
      return;
    } catch (e) {
      log.warn("set fell back to memory:", (e as Error).message);
    }
  }
  memory.set(key, value, ttlSeconds);
}

export async function kvDel(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const r = await getRedis();
  if (r) {
    try {
      await r.del(...keys);
      return;
    } catch (e) {
      log.warn("del fell back to memory:", (e as Error).message);
    }
  }
  memory.del(...keys);
}

/** Delete all keys matching `${prefix}*`. */
export async function kvDelByPrefix(prefix: string): Promise<void> {
  const r = await getRedis();
  if (r) {
    try {
      // SCAN must include REDIS_KEY_PREFIX explicitly (it is not auto-applied),
      // then strip it before DEL (which re-applies keyPrefix).
      const pattern = `${env.REDIS_KEY_PREFIX}${prefix}*`;
      let cursor = "0";
      do {
        const [next, keys] = await r.scan(cursor, "MATCH", pattern, "COUNT", 100);
        cursor = next;
        if (keys.length) {
          const unprefixed = keys.map((k) => k.slice(env.REDIS_KEY_PREFIX.length));
          await r.del(...unprefixed);
        }
      } while (cursor !== "0");
      return;
    } catch (e) {
      log.warn("delByPrefix fell back to memory:", (e as Error).message);
    }
  }
  memory.delByPrefix(prefix);
}

/** Atomic-ish increment with first-hit expiry; returns {count, ttl}. */
export async function kvIncr(
  key: string,
  windowSeconds: number,
): Promise<{ count: number; ttl: number }> {
  const r = await getRedis();
  if (r) {
    try {
      const count = await r.incr(key);
      if (count === 1) await r.expire(key, windowSeconds);
      const ttl = await r.ttl(key);
      return { count, ttl: ttl >= 0 ? ttl : windowSeconds };
    } catch (e) {
      log.warn("incr fell back to memory:", (e as Error).message);
    }
  }
  const count = memory.incr(key);
  if (count === 1) memory.expire(key, windowSeconds);
  const ttl = memory.ttl(key);
  return { count, ttl: ttl >= 0 ? ttl : windowSeconds };
}
