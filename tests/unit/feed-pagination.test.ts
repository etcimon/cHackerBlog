/**
 * Unit/integration tests for feed pagination correctness:
 *  - U1: cursor pagination stays complete and duplicate-free when many
 *    articles share the same publishedAt (needs a total order).
 *  - U2: the article-route locator materializes a bounded window that still
 *    contains a deep target, and nextCursor resumes exactly after it.
 *  - U3: the locator inlines content only for what the client expands
 *    (target + first FEED_EXPANDED_COUNT), not everything up to the target.
 */
process.env.DATABASE_URL = "file:./test.sqlite";
process.env.CACHE_DRIVER = "memory";

import { getFeed } from "@/lib/articles";
import { locateArticleForFirstLoad } from "@/lib/feed-locator";
import { getPrisma } from "@/lib/prisma";
import { invalidate } from "@/lib/cache";
import { env } from "@/lib/env";

const prisma = getPrisma();

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

async function collectAll(cursor?: string): Promise<string[]> {
  const ids: string[] = [];
  let next: string | undefined = cursor;
  do {
    const page = await getFeed(next ? { take: 2, cursor: next } : { take: 2 });
    ids.push(...page.items.map((i) => i.id));
    next = page.nextCursor ?? undefined;
  } while (next);
  return ids;
}

describe("feed pagination", () => {
  const savedEnv = {
    FEED_PAGE_SIZE: env.FEED_PAGE_SIZE,
    FEED_EXPANDED_COUNT: env.FEED_EXPANDED_COUNT,
    FEED_EXPAND_ALL: env.FEED_EXPAND_ALL,
  };

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.article.deleteMany();
    await prisma.tag.deleteMany();
    await invalidate("feed");
  });

  afterEach(() => {
    env.FEED_PAGE_SIZE = savedEnv.FEED_PAGE_SIZE;
    env.FEED_EXPANDED_COUNT = savedEnv.FEED_EXPANDED_COUNT;
    env.FEED_EXPAND_ALL = savedEnv.FEED_EXPAND_ALL;
  });

  it("U1: paginates completely and deterministically when publishedAt ties", async () => {
    const when = new Date("2024-01-01T00:00:00.000Z");
    for (let i = 1; i <= 7; i++) {
      await prisma.article.create({
        data: {
          slug: `tie-${i}`,
          title: `Tie ${i}`,
          content: "<p>tie</p>",
          published: true,
          publishedAt: when,
          locale: "en",
        },
      });
    }

    const walk1 = await collectAll();
    expect(walk1).toHaveLength(7);
    expect(new Set(walk1).size).toBe(7);

    const all = await getFeed({ take: 50 });
    expect(walk1).toEqual(all.items.map((i) => i.id));

    const walk2 = await collectAll();
    expect(walk2).toEqual(walk1);
  });

  it("U2: locator window reaches a deep target and resumes after it", async () => {
    // Pin the trailing-context buffer so the window math is deterministic in
    // any environment (.env values differ between local and CI).
    env.FEED_PAGE_SIZE = 3;
    for (let n = 0; n < 70; n++) {
      await prisma.article.create({
        data: {
          slug: `deep-${pad(n)}`,
          title: `Deep ${n}`,
          content: "<p>deep</p>",
          published: true,
          // deep-00 newest .. deep-69 oldest, all distinct.
          publishedAt: new Date(Date.now() - n * 60_000),
          locale: "en",
        },
      });
    }

    // Target ranked last: the window must end at it, not start at the feed top.
    const last = await locateArticleForFirstLoad("deep-69");
    expect(last.items.length).toBeLessThanOrEqual(60);
    expect(last.items[last.targetIndex]?.slug).toBe("deep-69");
    const expectedTail = Array.from(
      { length: last.items.length },
      (_, i) => `deep-${pad(69 - last.items.length + 1 + i)}`,
    );
    expect(last.items.map((i) => i.slug)).toEqual(expectedTail);
    expect(last.items[last.items.length - 1]?.slug).toBe("deep-69");

    // A mid-depth target: window contains it and nextCursor resumes exactly
    // after the materialized slice when one exists.
    const mid = await locateArticleForFirstLoad("deep-65");
    expect(mid.items[mid.targetIndex]?.slug).toBe("deep-65");
    if (mid.nextCursor) {
      const after = await getFeed({ cursor: mid.nextCursor, take: 50 });
      const consumed = mid.items.length;
      const start = Math.max(0, 65 + 1 + env.FEED_PAGE_SIZE - 60);
      const expectedAfter = Array.from(
        { length: 70 - (start + consumed) },
        (_, i) => `deep-${pad(start + consumed + i)}`,
      );
      expect(after.items.map((i) => i.slug)).toEqual(expectedAfter);
      // No overlap with the materialized slice.
      expect(after.items.some((i) => mid.items.some((m) => m.id === i.id))).toBe(
        false,
      );
    }
  });

  it("U3: locator inlines content only for expanded items", async () => {
    env.FEED_EXPANDED_COUNT = 2;
    env.FEED_EXPAND_ALL = false;
    for (let n = 1; n <= 5; n++) {
      await prisma.article.create({
        data: {
          slug: `exp-${n}`,
          title: `Exp ${n}`,
          content: `<p>body-${n}</p>`,
          published: true,
          publishedAt: new Date(Date.now() - n * 60_000),
          locale: "en",
        },
      });
    }

    // Newest target (index 0): first FEED_EXPANDED_COUNT items get content.
    const top = await locateArticleForFirstLoad("exp-1");
    expect(top.items[0]?.content).toBeDefined();
    expect(top.items[1]?.content).toBeDefined();
    expect(top.items[2]?.content).toBeUndefined();

    // Fourth article target: items 0,1 (expanded count) and the target itself.
    const fourth = await locateArticleForFirstLoad("exp-4");
    expect(fourth.items[0]?.content).toBeDefined();
    expect(fourth.items[1]?.content).toBeDefined();
    expect(fourth.items[2]?.content).toBeUndefined();
    expect(fourth.items[3]?.content).toBeDefined();

    env.FEED_EXPAND_ALL = true;
    // locate:* results are cached without env in the key — drop the entry
    // computed under FEED_EXPAND_ALL=false before re-locating.
    await invalidate("feed");
    const all = await locateArticleForFirstLoad("exp-4");
    expect(all.items.every((i) => i.content !== undefined)).toBe(true);
  });
});
