/**
 * Article service: cursor-paginated feed (recency order, optional tag/locale
 * filter) and admin CRUD. Feed pages are memoized in the "feed" cache category;
 * single articles in the "article" category. Mutations invalidate both.
 */
import { getPrisma } from "@/lib/prisma";
import { remember, invalidate } from "@/lib/cache";
import { env } from "@/lib/env";
import type { ArticleInput, FeedQuery } from "@/lib/schemas";
import { truncateContent } from "@/lib/types";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

export interface FeedPage {
  items: Array<{
    id: string;
    slug: string;
    title: string;
    coverUrl: string | null;
    locale: string;
    publishedAt: string;
    tags: string[];
    /** Truncated preview from full content. */
    preview: string;
    /** Full body only included for the very first feed item. */
    content?: string;
    /** Whether the article is pinned to the top of the feed. */
    pinned: boolean;
    /** Timestamp when the article was pinned. */
    pinnedAt: string | null;
    /** Whether the article is published. */
    published: boolean;
    /** Number of approved comments on the article. */
    commentCount: number;
  }>;
  nextCursor: string | null;
}

/** Recency-ordered, tag-filterable cursor feed. */
export async function getFeed(query: FeedQuery): Promise<FeedPage> {
  const take = query.take ?? env.FEED_PAGE_SIZE;
  const cacheId = `t=${query.tag ?? ""}|l=${query.locale ?? ""}|c=${query.cursor ?? ""}|n=${take}|ea=${env.FEED_EXPAND_ALL}|ec=${env.FEED_EXPANDED_COUNT}|iu=${query.includeUnpublished ?? false}`;

  // Bypass cache when including unpublished articles (admin mode)
  if (query.includeUnpublished) {
    console.log("[getFeed] Fetching with includeUnpublished=true");
    const prisma = getPrisma();
    const rows = await prisma.article.findMany({
      where: {
        ...(query.locale ? { locale: query.locale } : {}),
        ...(query.tag ? { tags: { some: { slug: query.tag } } } : {}),
      },
      orderBy: [
        { pinned: "desc" }, // Pinned articles first
        { pinnedAt: "desc" }, // Most recently pinned first
        { publishedAt: "desc" }, // Then by published date
      ],
      take: take + 1, // fetch one extra to compute nextCursor
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: {
        tags: { select: { slug: true } },
        _count: {
          select: { comments: true }
        }
      },
    });

    console.log(`[getFeed] Found ${rows.length} articles with includeUnpublished=true`);
    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const isFirstPage = !query.cursor;
    const expandAll = env.FEED_EXPAND_ALL;
    const expandedCount = env.FEED_EXPANDED_COUNT;

    return {
      items: page.map((a, idx) => ({
        id: a.id,
        slug: a.slug,
        title: a.title,
        preview: truncateContent(a.content, env.FEED_PREVIEW_CHARS),
        coverUrl: a.coverUrl,
        locale: a.locale,
        publishedAt: a.publishedAt.toISOString(),
        tags: a.tags.map((t: { slug: string }) => t.slug),
        pinned: a.pinned,
        pinnedAt: a.pinnedAt?.toISOString() ?? null,
        published: a.published,
        commentCount: a._count.comments,
        ...(expandAll || (isFirstPage && idx < expandedCount) ? { content: a.content } : {}),
      })),
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
    };
  }

  return remember<FeedPage>("feed", cacheId, async () => {
    console.log("[getFeed] Fetching with includeUnpublished=false (cached)");
    const prisma = getPrisma();
    const rows = await prisma.article.findMany({
      where: {
        published: true,
        ...(query.locale ? { locale: query.locale } : {}),
        ...(query.tag ? { tags: { some: { slug: query.tag } } } : {}),
      },
      orderBy: [
        { pinned: "desc" }, // Pinned articles first
        { pinnedAt: "desc" }, // Most recently pinned first
        { publishedAt: "desc" }, // Then by published date
      ],
      take: take + 1, // fetch one extra to compute nextCursor
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: {
        tags: { select: { slug: true } },
        _count: {
          select: { comments: true }
        }
      },
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const isFirstPage = !query.cursor;
    // If FEED_EXPAND_ALL is true, expand all articles on all pages.
    // Otherwise, expand only the first FEED_EXPANDED_COUNT articles of the first page.
    const expandAll = env.FEED_EXPAND_ALL;
    const expandedCount = env.FEED_EXPANDED_COUNT;

    return {
      items: page.map((a, idx) => ({
        id: a.id,
        slug: a.slug,
        title: a.title,
        preview: truncateContent(a.content, env.FEED_PREVIEW_CHARS),
        coverUrl: a.coverUrl,
        locale: a.locale,
        publishedAt: a.publishedAt.toISOString(),
        tags: a.tags.map((t: { slug: string }) => t.slug),
        pinned: a.pinned,
        pinnedAt: a.pinnedAt?.toISOString() ?? null,
        published: a.published,
        commentCount: a._count.comments,
        // Inline the body if expanding all, or for the first N articles of the first page.
        ...(expandAll || (isFirstPage && idx < expandedCount) ? { content: a.content } : {}),
      })),
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
    };
  });
}

/** Fetch a single article's full body (used by in-place "full text" expansion). */
export async function getArticleBody(id: string): Promise<{ content: string } | null> {
  return remember("article", id, async () => {
    const prisma = getPrisma();
    const a = await prisma.article.findUnique({
      where: { id },
      select: { content: true, published: true },
    });
    return a && a.published ? { content: a.content } : null;
  });
}

async function connectTags(names: string[]) {
  const prisma = getPrisma();
  const unique = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));
  const tags = await Promise.all(
    unique.map((name) =>
      prisma.tag.upsert({
        where: { slug: slugify(name) },
        update: {},
        create: { name, slug: slugify(name) },
      }),
    ),
  );
  return tags.map((t) => ({ id: t.id }));
}

export { connectTags };

export async function createArticle(input: ArticleInput) {
  const prisma = getPrisma();
  const tagConnect = await connectTags(input.tags);
  const baseSlug = slugify(input.title) || "untitled";
  // Ensure slug uniqueness.
  let slug = baseSlug;
  for (let i = 2; await prisma.article.findUnique({ where: { slug } }); i++) {
    slug = `${baseSlug}-${i}`;
  }
  const article = await prisma.article.create({
    data: {
      slug,
      title: input.title,
      content: input.content,
      coverUrl: input.coverUrl || null,
      locale: input.locale,
      published: input.published,
      tags: { connect: tagConnect },
    },
    include: { tags: true },
  });
  await invalidate("feed");
  return article;
}

export async function updateArticle(id: string, input: ArticleInput) {
  const prisma = getPrisma();
  const tagConnect = await connectTags(input.tags);

  // Get current article to disconnect existing tags
  const currentArticle = await prisma.article.findUnique({
    where: { id },
    include: { tags: true },
  });

  if (!currentArticle) {
    throw new Error("Article not found");
  }

  // Disconnect all existing tags
  const disconnect = currentArticle.tags.map((tag: { id: string }) => ({ id: tag.id }));

  const article = await prisma.article.update({
    where: { id },
    data: {
      title: input.title,
      content: input.content,
      coverUrl: input.coverUrl || null,
      locale: input.locale,
      published: input.published,
      tags: {
        disconnect,
        connect: tagConnect,
      },
    },
    include: { tags: true },
  });
  await invalidate("article", id);
  await invalidate("feed");
  return article;
}

export async function updateArticlePartial(id: string, input: { published?: boolean }) {
  const prisma = getPrisma();

  const article = await prisma.article.update({
    where: { id },
    data: {
      ...(input.published !== undefined ? { published: input.published } : {}),
    },
    include: { tags: true },
  });
  await invalidate("article", id);
  await invalidate("feed");
  return article;
}

export async function deleteArticle(id: string) {
  const prisma = getPrisma();
  await prisma.article.delete({ where: { id } });
  await invalidate("article", id);
  await invalidate("feed");
}

export async function listAllTags() {
  const prisma = getPrisma();
  return prisma.tag.findMany({ orderBy: { name: "asc" } });
}

export async function deleteTag(slug: string) {
  const prisma = getPrisma();
  // Check if tag is used by any articles
  const articleCount = await prisma.article.count({
    where: { tags: { some: { slug } } },
  });
  
  if (articleCount > 0) {
    throw new Error(`Cannot delete tag: ${articleCount} article(s) use this tag`);
  }
  
  await prisma.tag.delete({ where: { slug } });
}
