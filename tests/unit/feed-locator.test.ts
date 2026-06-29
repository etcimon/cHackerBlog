/**
 * Unit/integration tests for the feed locator endpoint.
 * Tests the locateArticleForFirstLoad function and its API route.
 */
process.env.DATABASE_URL = "file:./test.sqlite";
process.env.CACHE_DRIVER = "memory";

import { locateArticleForFirstLoad } from "@/lib/feed-locator";
import { getPrisma } from "@/lib/prisma";
import { Errors } from "@/lib/errors";

describe("Feed Locator", () => {
  let prisma: ReturnType<typeof getPrisma>;

  beforeAll(async () => {
    prisma = getPrisma();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean up all test data before each test
    await prisma.article.deleteMany();
    await prisma.tag.deleteMany();
  });

  it("should throw not found for non-existent slug", async () => {
    await expect(locateArticleForFirstLoad("non-existent-slug")).rejects.toThrow(
      "Article not found",
    );
  });

  it("should throw not found for unpublished article when includeUnpublished is false", async () => {
    // Create an unpublished article
    const article = await prisma.article.create({
      data: {
        title: "Unpublished Test",
        slug: "unpublished-test",
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

  it("should return published article when includeUnpublished is false", async () => {
    // Create a published article
    const article = await prisma.article.create({
      data: {
        title: "Published Test",
        slug: "published-test-locator",
        content: "<p>Test content</p>",
        published: true,
        publishedAt: new Date(),
        locale: "en",
      },
    });

    const result = await locateArticleForFirstLoad(article.slug);

    expect(result).toBeDefined();
    expect(result.targetSlug).toBe(article.slug);
    expect(result.targetId).toBe(article.id);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.slug).toBe(article.slug);
    expect(result.targetIndex).toBe(0);
  });

  it("should return unpublished article when includeUnpublished is true", async () => {
    const article = await prisma.article.create({
      data: {
        title: "Unpublished Admin Test",
        slug: "unpublished-admin-test",
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
  });

  it("should include content for target article", async () => {
    const article = await prisma.article.create({
      data: {
        title: "Content Test",
        slug: "content-test-locator",
        content: "<p>Full content here</p>",
        published: true,
        publishedAt: new Date(),
        locale: "en",
      },
    });

    const result = await locateArticleForFirstLoad(article.slug);

    expect(result.items[0]?.content).toBe("<p>Full content here</p>");
  });

  it("should scope to rarest tag when article has tags", async () => {
    // Create tags with different article counts
    const tag1 = await prisma.tag.create({
      data: { slug: "rare-tag", name: "Rare Tag" },
    });
    const tag2 = await prisma.tag.create({
      data: { slug: "common-tag", name: "Common Tag" },
    });

    // Add articles to make one tag more common
    await prisma.article.create({
      data: {
        title: "Common Article 1",
        slug: "common-1",
        content: "<p>Content</p>",
        published: true,
        publishedAt: new Date(),
        locale: "en",
        tags: { connect: { slug: "common-tag" } },
      },
    });

    await prisma.article.create({
      data: {
        title: "Common Article 2",
        slug: "common-2",
        content: "<p>Content</p>",
        published: true,
        publishedAt: new Date(),
        locale: "en",
        tags: { connect: { slug: "common-tag" } },
      },
    });

    // Create target article with both tags
    const target = await prisma.article.create({
      data: {
        title: "Target Article",
        slug: "target-with-tags",
        content: "<p>Target content</p>",
        published: true,
        publishedAt: new Date(),
        locale: "en",
        tags: { connect: [{ slug: "rare-tag" }, { slug: "common-tag" }] },
      },
    });

    const result = await locateArticleForFirstLoad(target.slug);

    // Should scope to the rarest tag
    expect(result.tag).toBe("rare-tag");
  });

  it("should return null tag when article has no tags", async () => {
    const article = await prisma.article.create({
      data: {
        title: "No Tags Article",
        slug: "no-tags-article",
        content: "<p>Content</p>",
        published: true,
        publishedAt: new Date(),
        locale: "en",
      },
    });

    const result = await locateArticleForFirstLoad(article.slug);

    expect(result.tag).toBeNull();
  });

  it("should order by pinned desc, pinnedAt desc, publishedAt desc", async () => {
    const now = new Date();
    const earlier = new Date(now.getTime() - 100000);

    // Create unpinned article
    const article1 = await prisma.article.create({
      data: {
        title: "Unpinned Earlier",
        slug: "unpinned-earlier",
        content: "<p>Content</p>",
        published: true,
        publishedAt: earlier,
        locale: "en",
      },
    });

    // Create pinned article
    const article2 = await prisma.article.create({
      data: {
        title: "Pinned Article",
        slug: "pinned-article",
        content: "<p>Content</p>",
        published: true,
        publishedAt: now,
        pinned: true,
        pinnedAt: now,
        locale: "en",
      },
    });

    // Locate the unpinned article - it should come after the pinned one
    const result = await locateArticleForFirstLoad(article1.slug);

    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.slug).toBe("pinned-article");
    expect(result.items[1]?.slug).toBe("unpinned-earlier");
    expect(result.targetIndex).toBe(1);
  });

  it("should provide nextCursor for pagination", async () => {
    // Create multiple articles
    await prisma.article.create({
      data: {
        title: "Article 1",
        slug: "locator-1",
        content: "<p>Content</p>",
        published: true,
        publishedAt: new Date(),
        locale: "en",
      },
    });

    await prisma.article.create({
      data: {
        title: "Article 2",
        slug: "locator-2",
        content: "<p>Content</p>",
        published: true,
        publishedAt: new Date(),
        locale: "en",
      },
    });

    const article3 = await prisma.article.create({
      data: {
        title: "Article 3",
        slug: "locator-3",
        content: "<p>Content</p>",
        published: true,
        publishedAt: new Date(),
        locale: "en",
      },
    });

    const result = await locateArticleForFirstLoad(article3.slug);

    // Should have a nextCursor if there are more articles beyond the fetch size
    expect(result).toHaveProperty("nextCursor");
  });
});
