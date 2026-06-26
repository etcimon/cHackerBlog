/**
 * Redis-backed memoization, organized by category. Each category has its own
 * key namespace and default TTL (sourced from env), so different kinds of data
 * — global settings, individual articles, feed pages — expire independently.
 *
 * `remember()` is the primary helper: it returns cached JSON if present,
 * otherwise runs the producer, caches the result, and returns it.
 *
 * The actual storage backend (Redis or an in-memory fallback) is abstracted by
 * lib/kv.ts and selected via CACHE_DRIVER, so caching keeps working even when
 * Redis is unavailable. All backend failures degrade to simply running the
 * producer (cache is never a hard dependency).
 */
import { kvGet, kvSet, kvDel, kvDelByPrefix } from "@/lib/kv";
import { env } from "@/lib/env";

export type CacheCategory = "settings" | "article" | "feed" | "ipgeo";

const TTL: Record<CacheCategory, number> = {
  settings: env.CACHE_TTL_GLOBAL_SETTINGS,
  article: env.CACHE_TTL_ARTICLE,
  feed: env.CACHE_TTL_FEED,
  ipgeo: 60 * 60 * 24, // geo data is stable; cache a day
};

function keyOf(category: CacheCategory, id: string): string {
  return `cache:${category}:${id}`;
}

export async function getCached<T>(
  category: CacheCategory,
  id: string,
): Promise<T | null> {
  try {
    const raw = await kvGet(keyOf(category, id));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function setCached<T>(
  category: CacheCategory,
  id: string,
  value: T,
  ttlSeconds?: number,
): Promise<void> {
  try {
    await kvSet(keyOf(category, id), JSON.stringify(value), ttlSeconds ?? TTL[category]);
  } catch {
    /* ignore cache write failures */
  }
}

export async function remember<T>(
  category: CacheCategory,
  id: string,
  producer: () => Promise<T>,
  ttlSeconds?: number,
): Promise<T> {
  const hit = await getCached<T>(category, id);
  if (hit !== null) return hit;
  const value = await producer();
  await setCached(category, id, value, ttlSeconds);
  return value;
}

/** Invalidate one key, or an entire category via prefix scan. */
export async function invalidate(
  category: CacheCategory,
  id?: string,
): Promise<void> {
  try {
    if (id) {
      await kvDel(keyOf(category, id));
      return;
    }
    await kvDelByPrefix(`cache:${category}:`);
  } catch {
    /* ignore */
  }
}
