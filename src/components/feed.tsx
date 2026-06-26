"use client";

/**
 * Client feed orchestrator: infinite scroll (recency order), tag filtering, and
 * admin entry points. The first item renders expanded (Medium-style). When the
 * sentinel nears the viewport we load the next cursor page; we also eagerly
 * prefetch `prefetchPages` additional pages for smoother scrolling (configured
 * via FEED_PREFETCH_PAGES on the server and passed in as a prop).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedItem, FeedPage, TagItem } from "@/lib/types";
import { api } from "@/lib/api-client";
import { ArticleCard } from "@/components/article-card";
import { TagBar } from "@/components/tag-bar";
import { AdminBar } from "@/components/admin-bar";
import { ArticleEditor } from "@/components/article-editor";
import { useAdmin } from "@/components/admin-context";

interface Props {
  initialPage: FeedPage;
  tags: TagItem[];
  prefetchPages: number;
  /** How many leading articles render fully expanded (FEED_EXPANDED_COUNT). */
  expandedCount: number;
  /** Whether to expand ALL articles in the feed (FEED_EXPAND_ALL). */
  expandAll: boolean;
}

export function Feed({ initialPage, tags, prefetchPages, expandedCount, expandAll }: Props) {
  const { isAdmin } = useAdmin();
  const [items, setItems] = useState<FeedItem[]>(initialPage.items);
  const [cursor, setCursor] = useState<string | null>(initialPage.nextCursor);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<FeedItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [allTags, setAllTags] = useState<TagItem[]>(tags);

  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  const fetchPage = useCallback(
    async (opts: { cursor?: string | null; tag?: string | null; reset?: boolean }) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (opts.cursor) params.set("cursor", opts.cursor);
        if (opts.tag) params.set("tag", opts.tag);
        const page = await api.get<FeedPage>(`/api/feed?${params.toString()}`);
        setItems((prev) => (opts.reset ? page.items : [...prev, ...page.items]));
        setCursor(page.nextCursor);
        return page;
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [],
  );

  // Re-query when the active tag changes.
  const selectTag = useCallback(
    (slug: string | null) => {
      setActiveTag(slug);
      setItems([]);
      setCursor(null);
      void fetchPage({ tag: slug, reset: true });
    },
    [fetchPage],
  );

  // Infinite scroll via IntersectionObserver, with eager multi-page prefetch.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      async (entries) => {
        if (!entries[0]?.isIntersecting || loadingRef.current || !cursor) return;
        let next: string | null = cursor;
        for (let i = 0; i <= prefetchPages && next; i++) {
          const page = await fetchPage({ cursor: next, tag: activeTag });
          next = page?.nextCursor ?? null;
        }
      },
      { rootMargin: "600px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [cursor, activeTag, prefetchPages, fetchPage]);

  const handleSaved = useCallback(async () => {
    setEditing(null);
    setCreating(false);
    // Refresh tags after article save
    const updatedTags = await api.get<TagItem[]>("/api/tags");
    setAllTags(updatedTags);
    selectTag(activeTag); // refresh feed in place
  }, [activeTag, selectTag]);

  return (
    <>
      <TagBar tags={allTags} active={activeTag} onSelect={selectTag} isAdmin={isAdmin} />

      <div>
        {items.map((item, idx) => (
          <ArticleCard
            key={item.id}
            item={item}
            expanded={expandAll || (idx < expandedCount && activeTag === null)}
            onEdit={setEditing}
          />
        ))}
      </div>

      {loading && <p className="py-6 text-center text-muted">Loading…</p>}
      {!cursor && items.length > 0 && (
        <p className="py-6 text-center text-muted">— end of feed —</p>
      )}
      {items.length === 0 && !loading && (
        <p className="py-10 text-center text-muted">No articles yet.</p>
      )}

      <div ref={sentinelRef} className="h-1" />

      <AdminBar onNewArticle={() => setCreating(true)} />

      {(creating || editing) && (
        <ArticleEditor
          article={editing}
          allTags={allTags}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
