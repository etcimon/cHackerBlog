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
  const { isAdmin, ready } = useAdmin();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<FeedItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [allTags, setAllTags] = useState<TagItem[]>(tags);
  const [initialLoaded, setInitialLoaded] = useState(false);

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
        if (isAdmin) params.set("includeUnpublished", "true");
        console.log(`[Feed fetchPage] isAdmin=${isAdmin}, params=${params.toString()}`);
        const page = await api.get<FeedPage>(`/api/feed?${params.toString()}`);
        console.log(`[Feed fetchPage] Received ${page.items.length} items`);
        setItems((prev) => (opts.reset ? page.items : [...prev, ...page.items]));
        setCursor(page.nextCursor);
        return page;
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [isAdmin],
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

  // Reload feed when admin status changes to include/exclude unpublished
  useEffect(() => {
    // Only reload if we have items (initial page loaded) and admin status changed
    if (items.length > 0) {
      setItems([]);
      setCursor(null);
      void fetchPage({ reset: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, fetchPage]);

  // Initial load: use server-provided data if not admin, otherwise fetch with admin status
  useEffect(() => {
    if (!initialLoaded && ready) {
      if (isAdmin) {
        // Admin: fetch fresh data including unpublished
        void fetchPage({ reset: true });
      } else {
        // Non-admin: use server-provided data
        setItems(initialPage.items);
        setCursor(initialPage.nextCursor);
      }
      setInitialLoaded(true);
    }
  }, [isAdmin, initialLoaded, ready, fetchPage, initialPage]);

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
    const editingId = editing?.id;
    setEditing(null);
    setCreating(false);
    // Refresh tags after article save
    const updatedTags = await api.get<TagItem[]>("/api/tags");
    setAllTags(updatedTags);
    await selectTag(activeTag); // refresh feed in place

    // If we were editing an article, fetch the updated version and set it back
    // so that clicking edit again loads the fresh data
    if (editingId) {
      try {
        const updatedPage = await fetchPage({ reset: true });
        if (updatedPage) {
          const updatedArticle = updatedPage.items.find(item => item.id === editingId);
          if (updatedArticle) {
            setEditing(updatedArticle);
          }
        }
      } catch (err) {
        console.error("Failed to fetch updated article:", err);
      }
    }
  }, [activeTag, selectTag, editing?.id, fetchPage]);

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
