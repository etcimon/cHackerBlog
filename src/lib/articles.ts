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
import { extractPreviewHtml } from "@/lib/embeds";
import { deriveSeo } from "@/lib/seo";
import { getSettings } from "@/lib/settings";
import { invalidateArticleTranslations, evictArticleTranslationCache } from "@/lib/grok";
import { Errors } from "@/lib/errors";

/** Slugs reserved for legal pages — excluded from the main feed. */
export const LEGAL_SLUGS = ["terms-conditions", "privacy-policy"] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];

function isLegalSlug(slug: string): boolean {
  return (LEGAL_SLUGS as readonly string[]).includes(slug);
}

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
    /** HTML preview up to a `--END PREVIEW--` separator, when one is present. */
    previewHtml?: string;
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
    /** Auto-derived, comma-separated SEO keywords (see lib/seo.ts). */
    seoKeywords: string;
    /** Auto-derived meta/social description. */
    seoDescription: string;
    /** Resolved absolute share image (cover -> first img -> favicon). */
    thumbnailUrl: string | null;
  }>;
  nextCursor: string | null;
}

/** Shared row->FeedItem projection so every feed source stays identical. */
type FeedRow = {
  id: string;
  slug: string;
  title: string;
  content: string;
  coverUrl: string | null;
  locale: string;
  publishedAt: Date;
  tags: { name: string; slug: string }[];
  pinned: boolean;
  pinnedAt: Date | null;
  published: boolean;
  seoKeywords: string;
  seoDescription: string;
  thumbnailUrl: string | null;
  _count: { comments: number };
};

export function mapFeedRow(
  a: FeedRow,
  opts: { includeContent: boolean },
): FeedPage["items"][number] {
  return {
    id: a.id,
    slug: a.slug,
    title: a.title,
    preview: truncateContent(a.content, env.FEED_PREVIEW_CHARS),
    // A `--END PREVIEW--` separator overrides the character-truncated preview:
    // render everything before it verbatim (full code blocks, embeds, etc.).
    ...(extractPreviewHtml(a.content)
      ? { previewHtml: extractPreviewHtml(a.content) as string }
      : {}),
    coverUrl: a.coverUrl,
    locale: a.locale,
    publishedAt: a.publishedAt.toISOString(),
    tags: a.tags.map((t) => t.name),
    pinned: a.pinned,
    pinnedAt: a.pinnedAt?.toISOString() ?? null,
    published: a.published,
    commentCount: a._count.comments,
    seoKeywords: a.seoKeywords,
    seoDescription: a.seoDescription,
    thumbnailUrl: a.thumbnailUrl,
    ...(opts.includeContent ? { content: a.content } : {}),
  };
}

/** Recency-ordered, tag-filterable cursor feed. */
export async function getFeed(query: FeedQuery): Promise<FeedPage> {
  const take = query.take ?? env.FEED_PAGE_SIZE;
  const cacheId = `t=${query.tag ?? ""}|l=${query.locale ?? ""}|c=${query.cursor ?? ""}|n=${take}|ea=${env.FEED_EXPAND_ALL}|ec=${env.FEED_EXPANDED_COUNT}|iu=${query.includeUnpublished ?? false}`;

  // Bypass cache when including unpublished articles (admin mode)
  if (query.includeUnpublished) {
    const prisma = getPrisma();
    const rows = await prisma.article.findMany({
      where: {
        slug: { notIn: [...LEGAL_SLUGS] },
        ...(query.locale ? { locale: query.locale } : {}),
        ...(query.tag ? { tags: { some: { slug: query.tag } } } : {}),
      },
      orderBy: [
        { pinned: "desc" }, // Pinned articles first
        { pinnedAt: "desc" }, // Most recently pinned first
        { publishedAt: "desc" }, // Then by published date
        { id: "desc" }, // Unique tie-breaker so cursor pages never skip/dup
      ],
      take: take + 1, // fetch one extra to compute nextCursor
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: {
        tags: { select: { name: true, slug: true } },
        _count: {
          select: { comments: { where: { approved: true } } }
        }
      },
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const isFirstPage = !query.cursor;
    const expandAll = env.FEED_EXPAND_ALL;
    const expandedCount = env.FEED_EXPANDED_COUNT;

    return {
      items: page.map((a, idx) =>
        mapFeedRow(a, {
          includeContent: expandAll || (isFirstPage && idx < expandedCount),
        }),
      ),
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
    };
  }

  return remember<FeedPage>("feed", cacheId, async () => {
    const prisma = getPrisma();
    const rows = await prisma.article.findMany({
      where: {
        published: true,
        slug: { notIn: [...LEGAL_SLUGS] },
        ...(query.locale ? { locale: query.locale } : {}),
        ...(query.tag ? { tags: { some: { slug: query.tag } } } : {}),
      },
      orderBy: [
        { pinned: "desc" }, // Pinned articles first
        { pinnedAt: "desc" }, // Most recently pinned first
        { publishedAt: "desc" }, // Then by published date
        { id: "desc" }, // Unique tie-breaker so cursor pages never skip/dup
      ],
      take: take + 1, // fetch one extra to compute nextCursor
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: {
        tags: { select: { name: true, slug: true } },
        _count: {
          select: { comments: { where: { approved: true } } }
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
      items: page.map((a, idx) =>
        // Inline the body if expanding all, or for the first N of the first page.
        mapFeedRow(a, {
          includeContent: expandAll || (isFirstPage && idx < expandedCount),
        }),
      ),
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
    };
  });
}

/**
 * Fetch a single article's full body. Used by:
 *  - the public in-place "full text" expansion (published only, cached), and
 *  - the admin editor, which must also read unpublished drafts (uncached).
 */
export async function getArticleBody(
  id: string,
  opts: { includeUnpublished?: boolean } = {},
): Promise<{ content: string } | null> {
  // Admin path: read drafts directly without touching the public cache.
  if (opts.includeUnpublished) {
    const prisma = getPrisma();
    const a = await prisma.article.findUnique({
      where: { id },
      select: { content: true },
    });
    return a ? { content: a.content } : null;
  }

  return remember("article", id, async () => {
    const prisma = getPrisma();
    const a = await prisma.article.findUnique({
      where: { id },
      select: { content: true, published: true },
    });
    return a && a.published ? { content: a.content } : null;
  });
}

/**
 * Fetch the fields needed to produce a translation: source title, body HTML and
 * locale. Published-only for the public translate endpoint; admins may pass
 * includeUnpublished to translate drafts.
 */
export async function getArticleTranslationSource(
  id: string,
  opts: { includeUnpublished?: boolean } = {},
): Promise<{ id: string; title: string; content: string; locale: string } | null> {
  const prisma = getPrisma();
  const a = await prisma.article.findUnique({
    where: { id },
    select: { id: true, title: true, content: true, locale: true, published: true },
  });
  if (!a) return null;
  if (!a.published && !opts.includeUnpublished) return null;
  return { id: a.id, title: a.title, content: a.content, locale: a.locale };
}

async function connectTags(names: string[]) {
  const prisma = getPrisma();
  const unique = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));
  const tags = await Promise.all(
    unique.map((name) =>
      prisma.tag.upsert({
        where: { slug: slugify(name) },
        update: { name }, // Update name to preserve case if tag already exists
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
  // Derive SEO/social metadata once, at write time (no custom-edit fields).
  const settings = await getSettings();
  const seo = deriveSeo({
    content: input.content,
    coverUrl: input.coverUrl || null,
    faviconUrl: settings.faviconUrl,
    appUrl: env.APP_URL,
  });
  const article = await prisma.article.create({
    data: {
      slug,
      title: input.title,
      content: input.content,
      coverUrl: input.coverUrl || null,
      locale: input.locale,
      published: input.published,
      tags: { connect: tagConnect },
      ...seo,
    },
    include: { tags: true },
  });
  await invalidate("feed");
  return article;
}

export async function updateArticle(id: string, input: ArticleInput) {
  const prisma = getPrisma();

  // If content is empty or effectively empty (only HTML tags with no text), delete the article
  const isEmptyContent = !input.content || 
    input.content.trim() === "" ||
    // Strip HTML tags and check if remaining text is empty
    input.content.replace(/<[^>]*>/g, "").trim() === "";

  if (isEmptyContent) {
    await deleteArticle(id);
    return null;
  }

  const tagConnect = await connectTags(input.tags);

  // Get current article to disconnect existing tags
  const currentArticle = await prisma.article.findUnique({
    where: { id },
    include: { tags: true },
  });

  if (!currentArticle) {
    throw Errors.notFound("Article not found");
  }

  // Disconnect all existing tags
  const disconnect = currentArticle.tags.map((tag: { id: string }) => ({ id: tag.id }));

  // Re-derive SEO/social metadata from the new content on every update.
  const settings = await getSettings();
  const seo = deriveSeo({
    content: input.content,
    coverUrl: input.coverUrl || null,
    faviconUrl: settings.faviconUrl,
    appUrl: env.APP_URL,
  });

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
      ...seo,
    },
    include: { tags: true },
  });
  await invalidate("article", id);
  await invalidate("feed");
  // Content changed: drop stale translations (cache + persisted rows).
  await invalidateArticleTranslations(id);
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
  // If the article was unpublished, evict cached translations so they are not
  // served for a draft. DB rows are kept (the article still exists and may be
  // re-published); only the cache is cleared to force a fresh lookup that will
  // respect the published check in getArticleTranslationSource.
  if (input.published === false) {
    await evictArticleTranslationCache(id);
  }
  return article;
}

export async function deleteArticle(id: string) {
  const prisma = getPrisma();
  await prisma.article.delete({ where: { id } });
  await invalidate("article", id);
  await invalidate("feed");
  // Persisted translations cascade-delete with the article; only evict cache.
  await evictArticleTranslationCache(id);
}

export async function listAllTags() {
  const prisma = getPrisma();
  const tags = await prisma.tag.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: {
          articles: {
            where: { published: true, slug: { notIn: [...LEGAL_SLUGS] } },
          },
        },
      },
    },
  });
  return tags.map((t) => ({ name: t.name, slug: t.slug, count: t._count.articles }));
}

export async function getTotalArticleCount(includeUnpublished = false) {
  const prisma = getPrisma();
  return prisma.article.count({
    where: {
      slug: { notIn: [...LEGAL_SLUGS] },
      ...(includeUnpublished ? {} : { published: true }),
    },
  });
}

export async function deleteTag(slug: string) {
  const prisma = getPrisma();
  const tag = await prisma.tag.findUnique({ where: { slug } });
  if (!tag) {
    throw Errors.notFound("Tag not found");
  }
  // Check if tag is used by any articles
  const articleCount = await prisma.article.count({
    where: { tags: { some: { slug } } },
  });

  if (articleCount > 0) {
    throw Errors.conflict(`Cannot delete tag: ${articleCount} article(s) use this tag`);
  }

  await prisma.tag.delete({ where: { slug } });
}

/**
 * Fetch a legal article by its slug. Returns null if not found. For public
 * access, only returns published articles with non-empty content.
 */
export async function getLegalArticle(
  slug: string,
  opts: { includeUnpublished?: boolean; locale?: string } = {},
): Promise<{ id: string; slug: string; title: string; content: string; published: boolean; translated?: boolean } | null> {
  if (!isLegalSlug(slug)) return null;
  const prisma = getPrisma();
  const article = await prisma.article.findUnique({
    where: { slug },
    select: { id: true, slug: true, title: true, content: true, published: true, locale: true },
  });
  if (!article) return null;
  if (!article.published && !opts.includeUnpublished) return null;

  // If a locale is requested and it differs from the article's own locale,
  // attempt to serve an existing ArticleTranslation for that locale. For
  // public access, only serve the translation when it is published and has
  // non-empty content; otherwise fall back to the base (default-locale)
  // article so the reader never sees a blank or unpublished page. For admin
  // access, return the translation regardless so it can be edited.
  if (opts.locale && opts.locale !== article.locale) {
    const translation = await prisma.articleTranslation.findUnique({
      where: { articleId_locale: { articleId: article.id, locale: opts.locale } },
      select: { title: true, content: true, published: true },
    });
    if (translation) {
      const hasContent = translation.content.replace(/<[^>]*>/g, "").trim().length > 0;
      if (opts.includeUnpublished || (translation.published && hasContent)) {
        return {
          id: article.id,
          slug: article.slug,
          title: translation.title,
          content: translation.content,
          published: translation.published,
          translated: true,
        };
      }
    }
  }

  return { id: article.id, slug: article.slug, title: article.title, content: article.content, published: article.published };
}

/**
 * Check the status of all legal articles. Used by the footer to decide
 * whether to show links to the public (published + non-empty) or to the
 * admin (empty/missing → edit prompt).
 */
export async function getLegalStatus(): Promise<
  Record<string, { exists: boolean; published: boolean; hasContent: boolean }>
> {
  const prisma = getPrisma();
  const result: Record<string, { exists: boolean; published: boolean; hasContent: boolean }> = {};
  for (const slug of LEGAL_SLUGS) {
    const article = await prisma.article.findUnique({
      where: { slug },
      select: { content: true, published: true },
    });
    const hasContent = !!article && article.content.replace(/<[^>]*>/g, "").trim().length > 0;
    result[slug] = {
      exists: !!article,
      published: article?.published ?? false,
      hasContent,
    };
  }
  return result;
}

/**
 * Create or update a legal article by its reserved slug. The slug is forced
 * (not derived from the title) so the legal pages always live at their
 * canonical URLs.
 */
export async function createOrUpdateLegalArticle(
  slug: string,
  input: { title: string; content: string; published: boolean },
) {
  if (!isLegalSlug(slug)) throw Errors.notFound("Legal article not found");
  const prisma = getPrisma();
  const settings = await getSettings();
  const seo = deriveSeo({
    content: input.content,
    coverUrl: null,
    faviconUrl: settings.faviconUrl,
    appUrl: env.APP_URL,
  });

  const existing = await prisma.article.findUnique({ where: { slug } });

  if (existing) {
    // If content is empty, delete the article (same behaviour as regular edit)
    const isEmptyContent =
      !input.content ||
      input.content.trim() === "" ||
      input.content.replace(/<[^>]*>/g, "").trim() === "";
    if (isEmptyContent) {
      await deleteArticle(existing.id);
      return null;
    }

    const article = await prisma.article.update({
      where: { id: existing.id },
      data: {
        title: input.title,
        content: input.content,
        published: input.published,
        ...seo,
      },
    });
    await invalidate("article", existing.id);
    await invalidate("feed");
    await invalidateArticleTranslations(existing.id);
    return article;
  }

  const article = await prisma.article.create({
    data: {
      slug,
      title: input.title,
      content: input.content,
      coverUrl: null,
      locale: "en",
      published: input.published,
      tags: {},
      ...seo,
    },
  });
  await invalidate("feed");
  return article;
}

/**
 * Upsert a manual translation for a legal article into the ArticleTranslation
 * table. Used when an admin edits the legal page in a non-default locale — the
 * base article is preserved and the translation is stored/updated separately.
 * If the content is empty, the translation row is deleted instead.
 */
export async function upsertLegalTranslation(
  slug: string,
  locale: string,
  input: { title: string; content: string; published: boolean },
) {
  if (!isLegalSlug(slug)) throw Errors.notFound("Legal article not found");
  const prisma = getPrisma();
  const article = await prisma.article.findUnique({ where: { slug } });
  if (!article) throw Errors.notFound("Legal article not found");

  const isEmptyContent =
    !input.content ||
    input.content.trim() === "" ||
    input.content.replace(/<[^>]*>/g, "").trim() === "";

  if (isEmptyContent) {
    await prisma.articleTranslation.deleteMany({
      where: { articleId: article.id, locale },
    }).catch(() => {});
    await invalidate("translation", `${article.id}:${locale}`);
    return null;
  }

  const translation = await prisma.articleTranslation.upsert({
    where: { articleId_locale: { articleId: article.id, locale } },
    update: { title: input.title, content: input.content, published: input.published, sourceLocale: article.locale },
    create: {
      articleId: article.id,
      locale,
      sourceLocale: article.locale,
      title: input.title,
      content: input.content,
      published: input.published,
    },
  });

  await invalidate("translation", `${article.id}:${locale}`);
  return translation;
}
