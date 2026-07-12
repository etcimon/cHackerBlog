/**
 * Round-robin registry of Telegram support GROUPS for the live-chat subsystem.
 *
 * The single hardcoded TELEGRAM_SUPPORT_CHAT_ID is now only a FALLBACK: support
 * groups register themselves at runtime with /start, and new visitor chats are
 * distributed round-robin across the registered (non-paused) groups. The unit of
 * round-robin is the GROUP (chatId) — each session still gets its own forum topic
 * inside the chosen group, so telegramThreadId stays unique and session
 * resolution is unchanged.
 *
 * SOURCE OF TRUTH: a Redis hash `chat:groups` (field=chatId, value=JSON), an INCR
 * counter `chat:groups:cursor`, and a flag `chat:groups:initialized`. Before the
 * first /start the env chat id is the fallback; once initialized an EMPTY list
 * DISABLES chat. Redis keys are auto-namespaced by the shared client's keyPrefix.
 *
 * CLUSTERING: the in-memory fallback (used when Redis is off) is PROCESS-LOCAL
 * and has no DB persistence, so cross-worker /start sharing REQUIRES Redis.
 * Without Redis, canDispatch() still returns true via the env fallback on unaware
 * workers, so chat keeps working (routing is just not globally round-robin) —
 * graceful degradation, not an outage.
 */
import { createLogger } from "@/lib/logger";
import { getReadyRedis } from "@/lib/chat/redis-lazy";

const log = createLogger("chat:registry");

const GROUPS_KEY = "chat:groups";
const CURSOR_KEY = "chat:groups:cursor";
const INITIALIZED_KEY = "chat:groups:initialized";

export interface ChatGroup {
  chatId: string;
  title?: string;
  paused: boolean;
  registeredAt: number;
}

/** Result of selecting a dispatch target for a new conversation. */
export interface DispatchTarget {
  chatId: string | null;
  disabled: boolean;
  reason?: string;
}

// In-memory fallback state (single process; mirrors the pubsub/attachment pattern).
const memGroups = new Map<string, ChatGroup>();
let memCursor = 0;
let memInitialized = false;

function serialize(group: ChatGroup): string {
  return JSON.stringify({ title: group.title, paused: group.paused, registeredAt: group.registeredAt });
}

function deserialize(chatId: string, raw: string): ChatGroup {
  try {
    const parsed = JSON.parse(raw) as Partial<ChatGroup>;
    return { chatId, title: parsed.title, paused: Boolean(parsed.paused), registeredAt: parsed.registeredAt ?? 0 };
  } catch {
    return { chatId, paused: false, registeredAt: 0 };
  }
}

/** Deterministic order (oldest first, chatId tiebreak) so round-robin is stable. */
function stableSort(groups: ChatGroup[]): ChatGroup[] {
  return [...groups].sort((a, b) => a.registeredAt - b.registeredAt || a.chatId.localeCompare(b.chatId));
}

/** /start: (re)register a group, unpausing it and preserving its registeredAt. */
export async function registerGroup(chatId: string, title?: string): Promise<ChatGroup> {
  const existing = await getGroup(chatId);
  const group: ChatGroup = {
    chatId,
    title: title ?? existing?.title,
    paused: false,
    registeredAt: existing?.registeredAt ?? Date.now(),
  };
  const redis = await getReadyRedis();
  if (redis) {
    await redis.hset(GROUPS_KEY, chatId, serialize(group));
    await redis.set(INITIALIZED_KEY, "1");
  } else {
    memGroups.set(chatId, group);
    memInitialized = true;
  }
  log.info("registered chat group", { chatId, title, reRegistered: Boolean(existing) });
  return group;
}

/** /pause: keep the group in the list but skip it when routing new chats. */
export async function pauseGroup(chatId: string): Promise<ChatGroup | null> {
  const existing = await getGroup(chatId);
  if (!existing) return null;
  const updated: ChatGroup = { ...existing, paused: true };
  const redis = await getReadyRedis();
  if (redis) await redis.hset(GROUPS_KEY, chatId, serialize(updated));
  else memGroups.set(chatId, updated);
  return updated;
}

/** /end: drop the group from the registry entirely. */
export async function removeGroup(chatId: string): Promise<boolean> {
  const redis = await getReadyRedis();
  if (redis) return (await redis.hdel(GROUPS_KEY, chatId)) > 0;
  return memGroups.delete(chatId);
}

export async function getGroup(chatId: string): Promise<ChatGroup | null> {
  const redis = await getReadyRedis();
  if (redis) {
    const raw = await redis.hget(GROUPS_KEY, chatId);
    return raw ? deserialize(chatId, raw) : null;
  }
  return memGroups.get(chatId) ?? null;
}

export async function listGroups(): Promise<ChatGroup[]> {
  const redis = await getReadyRedis();
  if (redis) {
    const all = await redis.hgetall(GROUPS_KEY);
    return Object.entries(all).map(([id, raw]) => deserialize(id, raw));
  }
  return Array.from(memGroups.values());
}

async function isInitialized(): Promise<boolean> {
  const redis = await getReadyRedis();
  if (redis) return (await redis.get(INITIALIZED_KEY)) === "1";
  return memInitialized;
}

async function nextCursor(): Promise<number> {
  const redis = await getReadyRedis();
  if (redis) return await redis.incr(CURSOR_KEY);
  memCursor += 1;
  return memCursor;
}

/**
 * PEEK: can a new chat be dispatched right now? Used by the widget config gate
 * and the send-route pre-check; does NOT advance the round-robin cursor.
 */
export async function canDispatch(): Promise<boolean> {
  const groups = await listGroups();
  if (groups.some((g) => !g.paused)) return true;
  if (!(await isInitialized())) return Boolean(process.env.TELEGRAM_SUPPORT_CHAT_ID);
  return false;
}

/**
 * CONSUME: pick the next target group in round-robin (advances the cursor).
 * Falls back to the env chat id only before initialization; once initialized an
 * empty active list returns { disabled: true }.
 */
export async function selectDispatchChatId(): Promise<DispatchTarget> {
  const groups = await listGroups();
  const active = stableSort(groups.filter((g) => !g.paused));
  if (active.length > 0) {
    const cursor = await nextCursor();
    const chosen = active[(cursor - 1) % active.length]!;
    return { chatId: chosen.chatId, disabled: false };
  }
  if (!(await isInitialized())) {
    const envId = process.env.TELEGRAM_SUPPORT_CHAT_ID;
    if (envId) return { chatId: envId, disabled: false };
  }
  return { chatId: null, disabled: true, reason: "no_active_groups" };
}

/** Test-only: clear in-memory fallback state for cross-file suite isolation. */
export function resetRegistryForTests(): void {
  memGroups.clear();
  memCursor = 0;
  memInitialized = false;
}
