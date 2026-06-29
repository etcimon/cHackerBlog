/**
 * Per-article SEO route (server component). This is the canonical, crawlable
 * destination for every shared/referenced article link (/article/<slug>).
 *
 * Two consumers, one route:
 *  - `generateMetadata` emits per-article Open Graph / Twitter / canonical tags
 *    from the auto-derived SEO fields, so social crawlers (which run no JS) get
 *    a correct title/description/image without any API or credentials.
 *  - The component locates the article within a tag-scoped feed slice and hands
 *    it to <Feed>, which scrolls the reader to it — i.e. we scroll within the
 *    feed rather than rendering the article in isolation.
 */
import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import { getSettings } from "@/lib/settings";
import { listAllTags } from "@/lib/articles";
import { locateArticleForFirstLoad } from "@/lib/feed-locator";
import { getPrisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { env } from "@/lib/env";
import { Feed } from "@/components/feed";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const [settings, article] = await Promise.all([
    getSettings(),
    getPrisma().article.findUnique({ where: { slug } }),
  ]);

  if (!article || !article.published) {
    return { title: "Article not found" };
  }

  const url = `${env.APP_URL.replace(/\/$/, "")}/article/${slug}`;
  const siteName = settings.title || "cHackerBlog";
  const description = article.seoDescription || settings.description || "";
  const images = article.thumbnailUrl ? [{ url: article.thumbnailUrl }] : undefined;

  return {
    title: `${article.title} — ${siteName}`,
    description,
    keywords: article.seoKeywords || undefined,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      url,
      siteName,
      title: article.title,
      description,
      images,
      publishedTime: article.publishedAt.toISOString(),
      modifiedTime: article.updatedAt.toISOString(),
      locale: article.locale,
    },
    twitter: {
      card: images ? "summary_large_image" : "summary",
      title: article.title,
      description,
      images: article.thumbnailUrl ? [article.thumbnailUrl] : undefined,
      ...(settings.xHandle ? { creator: `@${settings.xHandle.replace(/^@/, "")}` } : {}),
    },
  };
}

export default async function ArticlePage({ params }: Params) {
  const { slug } = await params;
  const settings = await getSettings();
  if (!settings.setupComplete) redirect("/setup");

  const admin = await isAdmin();

  let located;
  try {
    located = await locateArticleForFirstLoad(slug, { includeUnpublished: admin });
  } catch (err) {
    if (err instanceof AppError && err.status === 404) notFound();
    throw err;
  }

  const tags = await listAllTags();

  return (
    <main className="mx-auto max-w-5xl px-4">
      <header className="py-12 text-center">
        {settings.coverUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={settings.coverUrl}
            alt={settings.title}
            className="mb-6 h-48 w-full rounded-xl border border-border object-cover"
          />
        )}
        <h1 className="font-heading text-5xl font-extrabold tracking-tight text-fg">
          {settings.title}
        </h1>
        {settings.description && (
          <p className="mt-3 text-lg text-muted">{settings.description}</p>
        )}
      </header>

      <Feed
        initialPage={{ items: located.items, nextCursor: located.nextCursor }}
        tags={tags.map((t) => ({ name: t.name, slug: t.slug }))}
        prefetchPages={env.FEED_PREFETCH_PAGES}
        expandedCount={env.FEED_EXPANDED_COUNT}
        expandAll={env.FEED_EXPAND_ALL}
        initialTag={located.tag}
        initialTargetSlug={located.targetSlug}
        useHashScroll={true}
      />
    </main>
  );
}
