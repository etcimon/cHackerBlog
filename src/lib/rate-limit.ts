/**
 * IP-based rate limiting using a Redis fixed-window counter.
 *
 * Client IP resolution is Cloudflare-aware: when TRUST_CLOUDFLARE is enabled we
 * prefer the `CF-Connecting-IP` header, then `X-Forwarded-For` (first hop),
 * finally falling back to a sentinel. Counters go through lib/kv.ts, so they use
 * Redis when available and an in-memory window otherwise (CACHE_DRIVER). If the
 * backend errors entirely the limiter fails OPEN so an outage never takes down
 * the site.
 */
import { kvIncr } from "@/lib/kv";
import { env } from "@/lib/env";

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
}

/** Extract the best-known client IP from request headers. */
export function getClientIp(headers: Headers): string {
  if (env.TRUST_CLOUDFLARE) {
    const cf = headers.get("cf-connecting-ip");
    if (cf) return cf.trim();
  }
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  const real = headers.get("x-real-ip");
  if (real) return real.trim();
  return "0.0.0.0";
}

/**
 * Consume one unit from the bucket identified by (scope, ip).
 * `scope` lets different endpoints have independent budgets (e.g. "comment",
 * "feed", "upload").
 */
export async function rateLimit(
  ip: string,
  scope = "global",
  opts?: { max?: number; windowSeconds?: number },
): Promise<RateLimitResult> {
  const max = opts?.max ?? env.RATE_LIMIT_MAX_REQUESTS;
  const windowSeconds = opts?.windowSeconds ?? env.RATE_LIMIT_WINDOW_SECONDS;
  const key = `ratelimit:${scope}:${ip}`;

  try {
    const { count, ttl } = await kvIncr(key, windowSeconds);
    return {
      allowed: count <= max,
      limit: max,
      remaining: Math.max(0, max - count),
      resetSeconds: ttl,
    };
  } catch {
    // Fail open.
    return { allowed: true, limit: max, remaining: max, resetSeconds: windowSeconds };
  }
}
