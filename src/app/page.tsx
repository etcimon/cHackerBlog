/**
 * Home page (server component). On first run (setup incomplete) it redirects to
 * /setup. Otherwise it server-renders the masthead (cover, title, author) and
 * the initial feed page + tag list, then hands off to the client <Feed> for
 * infinite scroll, in-place expansion, tag filtering, and admin actions.
 */
import { redirect } from "next/navigation";
import { getSettings } from "@/lib/settings";
import { getFeed, listAllTags } from "@/lib/articles";
import { env } from "@/lib/env";
import { Feed } from "@/components/feed";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const settings = await getSettings();
  if (!settings.setupComplete) redirect("/setup");

  const [initialPage, tags] = await Promise.all([getFeed({}), listAllTags()]);

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
        {settings.authorName && (
          <div className="mt-4 flex items-center justify-center gap-2 text-sm text-muted">
            {settings.authorThumbUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={settings.authorThumbUrl}
                alt={settings.authorName}
                className="h-8 w-8 rounded-full border border-border object-cover"
              />
            )}
            <span>by {settings.authorName}</span>
          </div>
        )}
      </header>

      <Feed
        initialPage={initialPage}
        tags={tags.map((t) => ({ name: t.name, slug: t.slug }))}
        prefetchPages={env.FEED_PREFETCH_PAGES}
        expandedCount={env.FEED_EXPANDED_COUNT}
        expandAll={env.FEED_EXPAND_ALL}
      />
    </main>
  );
}
