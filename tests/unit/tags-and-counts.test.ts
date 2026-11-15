/**
 * DB-backed tests for tag deletion error mapping, approved-only comment
 * counts in feed responses, and reserved legal-slug exclusion in the
 * first-load locator.
 */
process.env.DATABASE_URL = "file:./test.sqlite";
process.env.CACHE_DRIVER = "memory";

import { deleteTag, getFeed } from "@/lib/articles";
import { locateArticleForFirstLoad } from "@/lib/feed-locator";
import { getPrisma } from "@/lib/prisma";
import { invalidate } from "@/lib/cache";
import { AppError } from "@/lib/errors";

async function expectAppError(promise: Promise<unknown>, status: number) {
  const err = await promise.then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).status).toBe(status);
  return err as AppError;
}

describe("Tag deletion and feed counts", () => {
  let prisma: ReturnType<typeof getPrisma>;

  beforeAll(async () => {
    prisma = getPrisma();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.comment.deleteMany();
    await prisma.article.deleteMany();
    await prisma.tag.deleteMany();
    // The feed/locator results are memoized in the "feed" cache category.
    await invalidate("feed");
  });

  it("deleteTag maps in-use to 409, missing to 404, and deletes unused tags", async () => {
    const used = await prisma.tag.create({
      data: { name: "Used Tag", slug: "used-tag" },
    });
    await prisma.article.create({
      data: {
        title: "Tagged Article",
        slug: "tagged-article-counts",
        content: "<p>body</p>",
        published: true,
        publishedAt: new Date(),
        locale: "en",
        tags: { connect: { id: used.id } },
      },
    });

    const conflict = await expectAppError(deleteTag("used-tag"), 409);
    expect(conflict.message).toContain("Cannot delete tag");
    expect(await prisma.tag.findUnique({ where: { slug: "used-tag" } })).not.toBeNull();

    await expectAppError(deleteTag("missing-tag"), 404);

    await prisma.tag.create({ data: { name: "Free Tag", slug: "free-tag" } });
    await deleteTag("free-tag");
    expect(await prisma.tag.findUnique({ where: { slug: "free-tag" } })).toBeNull();
  });

  it("commentCount counts only approved comments in getFeed and the locator", async () => {
    const article = await prisma.article.create({
      data: {
        title: "Counted Article",
        slug: "counted-article",
        content: "<p>body</p>",
        published: true,
        publishedAt: new Date(),
        locale: "en",
      },
    });
    await prisma.comment.create({
      data: { articleId: article.id, body: "approved comment", approved: true },
    });
    await prisma.comment.create({
      data: { articleId: article.id, body: "pending comment", approved: false },
    });

    const feed = await getFeed({});
    expect(feed.items.find((i) => i.slug === "counted-article")?.commentCount).toBe(1);

    const located = await locateArticleForFirstLoad("counted-article");
    expect(located.items.find((i) => i.slug === "counted-article")?.commentCount).toBe(1);
  });

  it("locator excludes legal slugs from feed slices and 404s them directly", async () => {
    await prisma.article.create({
      data: {
        title: "Privacy Policy",
        slug: "privacy-policy",
        content: "<p>legal</p>",
        published: true,
        publishedAt: new Date(),
        locale: "en",
      },
    });
    const normal = await prisma.article.create({
      data: {
        title: "Normal Post",
        slug: "normal-post-legal-test",
        content: "<p>body</p>",
        published: true,
        publishedAt: new Date(),
        locale: "en",
      },
    });

    const located = await locateArticleForFirstLoad(normal.slug);
    expect(located.items.some((i) => i.slug === "privacy-policy")).toBe(false);

    await expect(locateArticleForFirstLoad("privacy-policy")).rejects.toThrow(
      "Article not found",
    );
  });
});
