/**
 * First-load locator: resolve an article slug into a feed slice that already
 * contains the target, plus the index the client must scroll to.
 *
 * Design (see the architecture discussion):
 *  - Relatedness AND fetch-size minimization are the SAME decision: we scope the
 *    feed to the target's *rarest* tag, which both tightens topical relevance and
 *    shrinks the number of rows preceding the target.
 *  - Ranking replays getFeed's EXACT composite order
 *    (pinned desc, pinnedAt desc, publishedAt desc, id desc) by doing a
 *    lightweight id+slug scan over the scoped set, then materializes a bounded
 *    window ending at targetIndex + buffer (a prefix when the target is near
 *    the top, a slid window when it is deep).
 *  - The result is cache-coherent (memoized in the "feed" category, invalidated
 *    by the same article/feed mutations) and feeds straight into <Feed>.
 */
import { getPrisma } from "@/lib/prisma";
import { remember } from "@/lib/cache";
import { env } from "@/lib/env";
import { Errors } from "@/lib/errors";
import { LEGAL_SLUGS, mapFeedRow, type FeedPage } from "@/lib/articles";

/** Same ordering tuple getFeed uses; kept here so ranking stays identical. */
const FEED_ORDER = [
  { pinned: "desc" as const },
  { pinnedAt: "desc" as const },
  { publishedAt: "desc" as const },
  { id: "desc" as const }, // Unique tie-breaker, same as getFeed
];

/** Hard ceiling on how many items a single first-load may materialize. */
const MAX_FIRST_LOAD = 60;

export interface FirstLoadResult extends FeedPage {
  /** Slug of the requested article (echoed for the scroll target). */
  targetSlug: string;
  /** Id of the requested article. */
  targetId: string;
  /** Zero-based index of the target within `items`. */
  targetIndex: number;
  /** Tag slug the feed was scoped to, or null when no tag scoping applied. */
  tag: string | null;
}

/** Pick the target's most distinctive (least-used) tag for a tight feed. */
async function pickRarestTag(tagSlugs: string[]): Promise<string | null> {
  if (tagSlugs.length === 0) return null;
  const prisma = getPrisma();
  const tags = await prisma.tag.findMany({
    where: { slug: { in: tagSlugs } },
    select: { slug: true, _count: { select: { articles: true } } },
  });
  if (tags.length === 0) return null;
  tags.sort(
    (a, b) =>
      a._count.articles - b._count.articles || a.slug.localeCompare(b.slug),
  );
  return tags[0]!.slug;
}

/**
 * Locate `slug` and build the first-load feed slice. Throws Errors.notFound()
 * when the slug does not exist or is unpublished on the public path.
 */
export async function locateArticleForFirstLoad(
  slug: string,
  opts: { includeUnpublished?: boolean } = {},
): Promise<FirstLoadResult> {
  const includeUnpublished = opts.includeUnpublished ?? false;

  // Admin (includeUnpublished) bypasses the cache, mirroring getFeed.
  if (includeUnpublished) return computeFirstLoad(slug, true);

  return remember<FirstLoadResult>("feed", `locate:${slug}`, () =>
    computeFirstLoad(slug, false),
  );
}

async function computeFirstLoad(
  slug: string,
  includeUnpublished: boolean,
): Promise<FirstLoadResult> {
  const prisma = getPrisma();

  // Reserved legal pages live outside the feed; locating one is a 404.
  if ((LEGAL_SLUGS as readonly string[]).includes(slug)) {
    throw Errors.notFound("Article not found");
  }

  // 1. Resolve the slug -> row (with its tags) and enforce visibility.
  const target = await prisma.article.findUnique({
    where: { slug },
    include: { tags: { select: { name: true, slug: true } } },
  });
  if (!target || (!includeUnpublished && !target.published)) {
    throw Errors.notFound("Article not found");
  }

  // 2. Choose the rarest tag to scope the related feed (and shrink the prefix).
  const tag = await pickRarestTag(target.tags.map((t) => t.slug));

  const where = {
    ...(includeUnpublished ? {} : { published: true }),
    slug: { notIn: [...LEGAL_SLUGS] },
    ...(tag ? { tags: { some: { slug: tag } } } : {}),
  };

  // 3. Lightweight scan (id+slug only) in the exact feed order to find rank.
  const order = await prisma.article.findMany({
    where,
    orderBy: FEED_ORDER,
    select: { id: true, slug: true },
  });
  const rank = order.findIndex((r) => r.slug === slug);
  // Should always be found (target satisfies `where`), but guard defensively.
  const targetIndex = rank < 0 ? 0 : rank;

  // 4. Materialize a bounded window ending at targetIndex + buffer. When the
  // target sits deeper than MAX_FIRST_LOAD the window slides so it still ENDS
  // at the target's trailing context — the client only ever scrolls forward.
  const buffer = env.FEED_PAGE_SIZE; // one extra viewport of trailing context
  const end = targetIndex + 1 + buffer;
  const start = Math.max(0, end - MAX_FIRST_LOAD);
  const rows = await prisma.article.findMany({
    where,
    orderBy: FEED_ORDER,
    skip: start,
    take: end - start,
    include: {
      tags: { select: { name: true, slug: true } },
      _count: { select: { comments: { where: { approved: true } } } },
    },
  });

  // Index of the target within the returned window.
  const localTargetIndex = targetIndex - start;

  const items = rows.map((a, index) =>
    // Inline content only for what the client renders expanded: the located
    // target, the leading FEED_EXPANDED_COUNT window items, or everything
    // under FEED_EXPAND_ALL. The rest render collapsed and fetch on demand.
    mapFeedRow(a, {
      includeContent:
        env.FEED_EXPAND_ALL ||
        index === localTargetIndex ||
        index < env.FEED_EXPANDED_COUNT,
    }),
  );

  // nextCursor continues the SAME scoped order so <Feed> infinite-scroll resumes.
  const nextCursor =
    order.length > start + rows.length ? rows[rows.length - 1]!.id : null;

  return {
    items,
    nextCursor,
    targetSlug: slug,
    targetId: target.id,
    targetIndex: localTargetIndex,
    tag,
  };
}
