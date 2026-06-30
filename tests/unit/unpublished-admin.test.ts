/**
 * Unit test to debug unpublished article access as admin.
 * Tests the locateArticleForFirstLoad function with includeUnpublished flag.
 * Note: isAdmin() requires a Next.js request context, so we test the logic
 * that depends on the includeUnpublished flag directly.
 */
process.env.DATABASE_URL = "file:./test.sqlite";
process.env.CACHE_DRIVER = "memory";

import { getPrisma } from "@/lib/prisma";
import { locateArticleForFirstLoad } from "@/lib/feed-locator";

describe("Unpublished Article Admin Access", () => {
  let prisma: ReturnType<typeof getPrisma>;

  beforeAll(async () => {
    prisma = getPrisma();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.article.deleteMany();
    await prisma.tag.deleteMany();
  });

  it("locateArticleForFirstLoad should throw 404 for unpublished article without admin flag", async () => {
    const article = await prisma.article.create({
      data: {
        title: "Unpublished Test",
        slug: "unpublished-debug-test",
        content: "<p>Test content</p>",
        published: false,
        publishedAt: new Date(),
        locale: "en",
      },
    });

    await expect(locateArticleForFirstLoad(article.slug)).rejects.toThrow(
      "Article not found",
    );
  });

  it("locateArticleForFirstLoad should return unpublished article with includeUnpublished=true", async () => {
    const article = await prisma.article.create({
      data: {
        title: "Unpublished Admin Debug",
        slug: "unpublished-admin-debug",
        content: "<p>Test content</p>",
        published: false,
        publishedAt: new Date(),
        locale: "en",
      },
    });

    const result = await locateArticleForFirstLoad(article.slug, {
      includeUnpublished: true,
    });

    expect(result).toBeDefined();
    expect(result.targetSlug).toBe(article.slug);
    expect(result.targetId).toBe(article.id);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.slug).toBe(article.slug);
  });

  it("locateArticleForFirstLoad with includeUnpublished=true should bypass cache", async () => {
    const article = await prisma.article.create({
      data: {
        title: "Cache Bypass Test",
        slug: "cache-bypass-test",
        content: "<p>Test content</p>",
        published: false,
        publishedAt: new Date(),
        locale: "en",
      },
    });

    // First call with includeUnpublished=true should work
    const result1 = await locateArticleForFirstLoad(article.slug, {
      includeUnpublished: true,
    });
    expect(result1.targetSlug).toBe(article.slug);

    // Second call without includeUnpublished should still throw (cache not polluted)
    await expect(locateArticleForFirstLoad(article.slug)).rejects.toThrow(
      "Article not found",
    );
  });

  it("should handle unpublished article with tags correctly", async () => {
    const tag = await prisma.tag.create({
      data: { slug: "debug-tag", name: "Debug Tag" },
    });

    const article = await prisma.article.create({
      data: {
        title: "Unpublished with Tags",
        slug: "unpublished-with-tags",
        content: "<p>Test content</p>",
        published: false,
        publishedAt: new Date(),
        locale: "en",
        tags: { connect: { slug: "debug-tag" } },
      },
    });

    const result = await locateArticleForFirstLoad(article.slug, {
      includeUnpublished: true,
    });

    expect(result.targetSlug).toBe(article.slug);
    expect(result.items[0]?.tags).toEqual(["debug-tag"]);
  });
});
