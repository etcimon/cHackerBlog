/**
 * In-memory key/value store used as a drop-in fallback when Redis (ioredis) is
 * unavailable, and as the deterministic backend in tests (CACHE_DRIVER=memory).
 *
 * It mirrors the small subset of Redis semantics the app relies on: string
 * get/set with TTL, incr, expire, ttl (-2 missing / -1 no-expiry / seconds),
 * and prefix-based bulk delete (used for category cache invalidation). Expired
 * entries are removed lazily on access and swept periodically.
 */
interface Entry {
  value: string;
  /** Absolute expiry epoch ms, or null for no expiry. */
  expiresAt: number | null;
}

export class MemoryStore {
  private map = new Map<string, Entry>();

  constructor(sweepIntervalMs = 30_000) {
    // Periodic sweep of expired keys. unref() so it never keeps a test process
    // (or the server) alive on its own.
    const timer = setInterval(() => this.sweep(), sweepIntervalMs);
    if (typeof timer === "object" && "unref" in timer) timer.unref();
  }

  private isExpired(e: Entry): boolean {
    return e.expiresAt !== null && e.expiresAt <= Date.now();
  }

  private sweep(): void {
    for (const [k, e] of this.map) {
      if (this.isExpired(e)) this.map.delete(k);
    }
  }

  get(key: string): string | null {
    const e = this.map.get(key);
    if (!e) return null;
    if (this.isExpired(e)) {
      this.map.delete(key);
      return null;
    }
    return e.value;
  }

  set(key: string, value: string, ttlSeconds?: number): void {
    this.map.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  del(...keys: string[]): void {
    for (const k of keys) this.map.delete(k);
  }

  /** Delete every key beginning with `prefix` (the part before a trailing "*"). */
  delByPrefix(prefix: string): void {
    for (const k of this.map.keys()) {
      if (k.startsWith(prefix)) this.map.delete(k);
    }
  }

  incr(key: string): number {
    const current = this.get(key);
    const next = (current ? parseInt(current, 10) : 0) + 1;
    const existing = this.map.get(key);
    // Preserve any existing expiry across increments (matches Redis INCR).
    this.map.set(key, {
      value: String(next),
      expiresAt: existing && !this.isExpired(existing) ? existing.expiresAt : null,
    });
    return next;
  }

  expire(key: string, seconds: number): void {
    const e = this.map.get(key);
    if (e && !this.isExpired(e)) e.expiresAt = Date.now() + seconds * 1000;
  }

  ttl(key: string): number {
    const e = this.map.get(key);
    if (!e || this.isExpired(e)) return -2;
    if (e.expiresAt === null) return -1;
    return Math.ceil((e.expiresAt - Date.now()) / 1000);
  }

  /** Test helper: wipe everything. */
  clear(): void {
    this.map.clear();
  }
}
