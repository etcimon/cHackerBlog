"use client";

/**
 * A single feed article. The first article (expanded=true) renders its full
 * body immediately. Every other article shows the preview plus a "Full text"
 * button that fetches the body in place (GET /api/articles/:id) without a
 * reload, then animates it open.
 */
import {
  useCallback,
  useState,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { ChevronDown, Pencil, Tag as TagIcon, Pin, PinOff, EyeOff } from "lucide-react";
import type { FeedItem } from "@/lib/types";
import { api, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/toast";
import { useAdmin } from "@/components/admin-context";
import { CommentBar } from "@/components/comment-bar";
import { useCommentsEnabled } from "@/lib/use-comments-enabled";
import {
  ensureHighlightJsReady,
  highlightCodeInElement,
  wireCodeBlockToggles,
  type CodeToggleOptions,
} from "@/lib/highlight";

// useLayoutEffect on the server logs a warning; fall back to useEffect there.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

interface Props {
  item: FeedItem;
  expanded?: boolean;
  onEdit?: (item: FeedItem) => void;
}

export function ArticleCard({ item, expanded = false, onEdit }: Props) {
  const [open, setOpen] = useState(expanded);
  const [content, setContent] = useState<string | undefined>(item.content);
  const [loading, setLoading] = useState(false);
  const [pinned, setPinned] = useState(item.pinned);
  const [pinning, setPinning] = useState(false);
  const [published, setPublished] = useState(item.published);
  const [publishing, setPublishing] = useState(false);
  const toast = useToast();
  const { isAdmin } = useAdmin();
  const commentsEnabled = useCommentsEnabled();
  const articleBodyRef = useRef<HTMLDivElement>(null);
  // Remembers which code blocks the reader expanded, keyed by block index, so
  // the state survives content re-injection (e.g. after an admin edit refresh).
  const expandedBlocksRef = useRef<Set<number>>(new Set());

  // Keep the rendered body in sync with the feed item's content. Without this,
  // an article edited in the WYSIWYG keeps showing the stale body (useState only
  // reads its initial value once). Guard on `undefined` so lazily fetched
  // bodies (item.content omitted by the feed API) are not wiped.
  useEffect(() => {
    if (item.content !== undefined) setContent(item.content);
  }, [item.content]);

  const codeToggleOptions = useMemo<CodeToggleOptions>(
    () => ({
      isExpanded: (i) => expandedBlocksRef.current.has(i),
      onToggle: (i, expanded) => {
        if (expanded) expandedBlocksRef.current.add(i);
        else expandedBlocksRef.current.delete(i);
      },
    }),
    [],
  );

  // Wire the collapse toggles synchronously after every body (re-)render. Doing
  // this in a layout effect (not gated behind async highlighting) guarantees the
  // toggles work no matter how many code blocks/languages are present, and
  // re-applies the persisted expanded state before paint so it never flickers
  // back to collapsed.
  useIsoLayoutEffect(() => {
    if (open && content !== undefined && articleBodyRef.current) {
      wireCodeBlockToggles(articleBodyRef.current, codeToggleOptions);
    }
  }, [open, content, codeToggleOptions]);

  // Apply syntax highlighting asynchronously (lazy-loads hljs + languages), then
  // re-wire/restore in case highlighting replaced any markup.
  useEffect(() => {
    if (open && content !== undefined && articleBodyRef.current) {
      ensureHighlightJsReady(content).then(() => {
        if (articleBodyRef.current) {
          highlightCodeInElement(articleBodyRef.current);
          wireCodeBlockToggles(articleBodyRef.current, codeToggleOptions);
        }
      });
    }
  }, [open, content, codeToggleOptions]);

  const handlePin = async () => {
    setPinning(true);
    try {
      if (pinned) {
        await api.unpinArticle<{ pinned: boolean; pinnedAt: string | null }>(item.id);
        setPinned(false);
        toast.success("Article unpinned");
      } else {
        await api.pinArticle<{ pinned: boolean; pinnedAt: string | null }>(item.id);
        setPinned(true);
        toast.success("Article pinned");
      }
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Failed to update pin status");
    } finally {
      setPinning(false);
    }
  };

  const handlePublish = async () => {
    setPublishing(true);
    try {
      await api.put(`/api/articles/${item.id}`, { published: true });
      setPublished(true);
      toast.success("Article published");
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Failed to publish article");
    } finally {
      setPublishing(false);
    }
  };

  const loadFull = useCallback(async () => {
    if (content !== undefined) {
      setOpen(true);
      return;
    }
    setLoading(true);
    try {
      const data = await api.get<{ content: string }>(`/api/articles/${item.id}`);
      setContent(data.content);
      setOpen(true);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Failed to load article");
    } finally {
      setLoading(false);
    }
  }, [content, item.id, toast]);

  const date = new Date(item.publishedAt).toLocaleDateString(item.locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <>
      <div id={`${item.slug}-top`} className="scroll-mt-0" />
      <article
        id={item.slug}
        data-testid="article-card"
        className="animate-fade-in scroll-mt-24 border-b border-border py-10"
      >
        <header id={`${item.slug}-header`} className="mb-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {item.tags.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-xs text-muted"
              >
                <TagIcon className="h-3 w-3" />
                {t}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {pinned && (
              <div className="inline-flex items-center gap-1.5 rounded-md border border-accent bg-accent/10 px-3 py-1.5 text-xs text-accent">
                <Pin className="h-3.5 w-3.5" />
                <span className="font-semibold">Pinned</span>
              </div>
            )}
            {!published && isAdmin && (
              <button
                onClick={handlePublish}
                disabled={publishing}
                className="inline-flex items-center gap-1.5 rounded-md border border-orange-500 bg-orange-500/10 px-3 py-1.5 text-xs text-orange-500 transition-colors hover:bg-orange-500/20 disabled:opacity-50"
                title="Click to publish article"
              >
                <EyeOff className="h-3.5 w-3.5" />
                <span className="font-semibold">Unpublished</span>
              </button>
            )}
            {isAdmin && (
              <button
                onClick={handlePin}
                disabled={pinning}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:text-fg disabled:opacity-50"
                title={pinned ? "Unpin article" : "Pin article"}
              >
                {pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
              </button>
            )}
          </div>
        </div>
        <h2 className="font-heading text-3xl font-bold leading-tight text-fg">
          <a
            href={`/article/${item.slug}`}
            className="transition-colors hover:text-accent"
          >
            {item.title}
          </a>
        </h2>
        <p className="mt-1 text-sm text-muted">{date}</p>
      </header>

      {item.coverUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.coverUrl}
          alt={item.title}
          className="mb-4 w-full rounded-lg border border-border object-cover"
        />
      )}

      {!open && <p className="text-lg leading-relaxed text-fg/90">{item.preview}</p>}

      {open && content !== undefined && (
        <div
          ref={articleBodyRef}
          className="article-body animate-expand overflow-hidden text-lg text-fg/90"
          dangerouslySetInnerHTML={{ __html: content }}
        />
      )}

      <div className="mt-4 flex items-center gap-3">
        {!open && (
          <button
            onClick={loadFull}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-accent px-4 py-2 text-sm font-semibold text-accent transition-colors hover:bg-accent hover:text-bg disabled:opacity-50"
          >
            <ChevronDown className="h-4 w-4" />
            {loading ? "Loading…" : "Full text"}
          </button>
        )}
        {isAdmin && onEdit && (
          <button
            onClick={() => onEdit(item)}
            title="Edit article"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm text-muted transition-colors hover:text-fg"
          >
            <Pencil className="h-4 w-4" />
            Edit
          </button>
        )}
      </div>

      {open && (
        <CommentBar
          articleId={item.id}
          slug={item.slug}
          commentsEnabled={commentsEnabled}
          commentCount={item.commentCount}
          title={item.title}
          seoDescription={item.seoDescription}
          seoKeywords={item.seoKeywords}
          thumbnailUrl={item.thumbnailUrl}
        />
      )}
    </article>
    </>
  );
}
