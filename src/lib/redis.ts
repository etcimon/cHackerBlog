/**
 * ioredis client singleton. Same hot-reload caching rationale as prisma.ts.
 * All keys are namespaced via REDIS_KEY_PREFIX (see env). Higher-level helpers
 * (cache.ts, rate-limit.ts) build on this rather than importing ioredis.
 */
import Redis from "ioredis";
import { env, isProd } from "@/lib/env";
import { createLogger } from "@/lib/logger";

const log = createLogger("redis");

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
  connectionErrorLogged: boolean;
};

export const redis =
  globalForRedis.redis ??
  new Redis(env.REDIS_URL, {
    keyPrefix: env.REDIS_KEY_PREFIX,
    maxRetriesPerRequest: 2,
    lazyConnect: false,
    // Avoid crashing the whole app if Redis is briefly unreachable; callers
    // degrade gracefully (cache miss / fail-open rate limit).
    enableOfflineQueue: true,
  });

if (!isProd) globalForRedis.redis = redis;
if (!globalForRedis.connectionErrorLogged) globalForRedis.connectionErrorLogged = false;

redis.on("error", (err) => {
  // Do not throw — Redis is a performance/limit aid, not a hard dependency.
  // Callers fall back to the in-memory cache (see lib/cache.ts).
  // Only log the first connection error to avoid spamming logs.
  if (!globalForRedis.connectionErrorLogged) {
    log.warn("connection error:", err.message);
    globalForRedis.connectionErrorLogged = true;
  }
});

redis.on("connect", () => {
  // Reset the error flag when connection is restored
  globalForRedis.connectionErrorLogged = false;
});
