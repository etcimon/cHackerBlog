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
import { ChevronDown, Pencil, Tag as TagIcon, Pin, PinOff, EyeOff, Languages } from "lucide-react";
import type { FeedItem } from "@/lib/types";
import { api, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/toast";
import { useAdmin } from "@/components/admin-context";
import { useSiteConfig } from "@/lib/use-site-config";
import { useI18n } from "@/lib/use-i18n";
import { buildLocalePath, DEFAULT_LOCALE } from "@/lib/i18n";
import { CommentBar } from "@/components/comment-bar";
import { useCommentsEnabled } from "@/lib/use-comments-enabled";
import {
  ensureHighlightJsReady,
  highlightCodeInElement,
  wireCodeBlockToggles,
  type CodeToggleOptions,
} from "@/lib/highlight";
import { hydrateLinkEmbeds } from "@/lib/link-embeds";
import { scrollToAnchor } from "@/lib/scroll";

// useLayoutEffect on the server logs a warning; fall back to useEffect there.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

interface Props {
  item: FeedItem;
  expanded?: boolean;
  onEdit?: (item: FeedItem) => void;
}

export function ArticleCard({ item, expanded = false, onEdit }: Props) {
  // Expanded cards whose body wasn't inlined by the feed/locator payload start
  // collapsed (preview + button) and self-fetch via the effect below — never
  // blank.
  const [open, setOpen] = useState(expanded && item.content !== undefined);
  const [expandedDone, setExpandedDone] = useState(false);
  const [content, setContent] = useState<string | undefined>(item.content);
  const [loading, setLoading] = useState(false);
  const [pinned, setPinned] = useState(item.pinned);
  const [pinning, setPinning] = useState(false);
  const [published, setPublished] = useState(item.published);
  const [publishing, setPublishing] = useState(false);
  // Translation state (Grok-powered). `translated` toggles the view between the
  // original body/title and the fetched translation for the visitor's locale.
  const [translated, setTranslated] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translatedTitle, setTranslatedTitle] = useState<string | undefined>(undefined);
  const [translatedContent, setTranslatedContent] = useState<string | undefined>(undefined);
  const toast = useToast();
  const { isAdmin } = useAdmin();
  const config = useSiteConfig();
  const { locale: userLocale, t } = useI18n();
  const commentsEnabled = useCommentsEnabled();
  const defaultLocale = config?.defaultLocale ?? DEFAULT_LOCALE;
  const articleHref = buildLocalePath(`/article/${item.slug}`, userLocale, defaultLocale);
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

  // What to render in the article body: the full content when open, otherwise
  // the HTML preview (present only when the article defines a `--END PREVIEW--`
  // separator). Undefined means "nothing to render yet" (e.g. body not fetched).
  // Whether the Grok "show translation" affordance applies: the integration is
  // configured and the visitor's resolved locale (from the /[lang]/ URL prefix,
  // browser, or site policy) differs from the article's own language.
  const canTranslate = !!config?.grokConfigured && userLocale !== item.locale;

  const displayTitle = translated && translatedTitle !== undefined ? translatedTitle : item.title;

  // When showing a translation we always render the full translated body;
  // otherwise the original full content (when open) or the preview HTML.
  const bodyHtml =
    translated && translatedContent !== undefined
      ? translatedContent
      : open
        ? content
        : item.previewHtml;

  // React re-assigns innerHTML whenever this object's identity changes, which
  // would discard link-card hydration and code-block state on unrelated
  // re-renders — memoize so only a real bodyHtml change re-injects the markup.
  const bodyMarkup = useMemo(() => ({ __html: bodyHtml ?? "" }), [bodyHtml]);

  // Wire the collapse toggles synchronously after every body (re-)render. Doing
  // this in a layout effect (not gated behind async highlighting) guarantees the
  // toggles work no matter how many code blocks/languages are present, and
  // re-applies the persisted expanded state before paint so it never flickers
  // back to collapsed.
  useIsoLayoutEffect(() => {
    if (bodyHtml !== undefined && articleBodyRef.current) {
      wireCodeBlockToggles(articleBodyRef.current, codeToggleOptions);
      hydrateLinkEmbeds(articleBodyRef.current);
    }
  }, [bodyHtml, codeToggleOptions]);

  // Apply syntax highlighting asynchronously (lazy-loads hljs + languages), then
  // re-wire/restore in case highlighting replaced any markup. The stale flag
  // ensures that if bodyHtml changes before the promise resolves (e.g. user
  // toggles translation while hljs is still loading), the stale callback is
  // skipped and only the latest bodyHtml gets highlighted.
  useEffect(() => {
    let stale = false;
    if (bodyHtml !== undefined && articleBodyRef.current) {
      ensureHighlightJsReady(bodyHtml).then(() => {
        if (!stale && articleBodyRef.current) {
          highlightCodeInElement(articleBodyRef.current);
          wireCodeBlockToggles(articleBodyRef.current, codeToggleOptions);
        }
      });
    }
    return () => { stale = true; };
  }, [bodyHtml, codeToggleOptions]);

  const handlePin = async () => {
    setPinning(true);
    try {
      if (pinned) {
        await api.unpinArticle<{ pinned: boolean; pinnedAt: string | null }>(item.id);
        setPinned(false);
        toast.success(t("article.articleUnpinned"));
      } else {
        await api.pinArticle<{ pinned: boolean; pinnedAt: string | null }>(item.id);
        setPinned(true);
        toast.success(t("article.articlePinned"));
      }
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : t("article.failedPin"));
    } finally {
      setPinning(false);
    }
  };

  const handlePublish = async () => {
    setPublishing(true);
    try {
      await api.put(`/api/articles/${item.id}`, { published: true });
      setPublished(true);
      toast.success(t("article.articlePublished"));
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : t("article.failedPublish"));
    } finally {
      setPublishing(false);
    }
  };

  const loadFull = useCallback(
    async (opts?: { scroll?: boolean }) => {
      const scroll = opts?.scroll ?? true;
      if (content !== undefined) {
        setExpandedDone(false);
        setOpen(true);
        return;
      }
      setLoading(true);
      try {
        const data = await api.get<{ content: string }>(`/api/articles/${item.id}`);
        setContent(data.content);
        setExpandedDone(false);
        setOpen(true);
        // Scroll to the article's top anchor after content loads
        if (scroll) {
          setTimeout(() => {
            scrollToAnchor(`${item.slug}-top`);
          }, 100);
        }
      } catch (err) {
        toast.error(err instanceof ApiClientError ? err.message : t("article.failedLoad"));
      } finally {
        setLoading(false);
      }
    },
    [content, item.id, item.slug, toast, isAdmin],
  );

  // An expanded card asked to render without an inlined body (e.g.
  // FEED_EXPANDED_COUNT reaching past the first page, or a located target deep
  // in a re-scoped feed) loads it itself instead of rendering blank. The ref
  // keeps StrictMode's double effect from firing two requests.
  const autoLoadRef = useRef(false);
  useEffect(() => {
    if (!expanded || content !== undefined || autoLoadRef.current) return;
    autoLoadRef.current = true;
    void loadFull({ scroll: false });
  }, [expanded, content, loadFull]);

  const handleTranslate = useCallback(async () => {
    if (translated) {
      setTranslated(false);
      return;
    }
    // Reuse a previously fetched translation without another round-trip.
    if (translatedContent !== undefined) {
      setExpandedDone(false);
      setTranslated(true);
      setOpen(true);
      return;
    }
    setTranslating(true);
    try {
      const data = await api.translateArticle<{
        enabled: boolean;
        locale?: string;
        title?: string;
        content?: string;
      }>(item.id, userLocale);
      if (!data.enabled || data.content === undefined) {
        toast.error(t("translation.failed"));
        return;
      }
      setTranslatedTitle(data.title);
      setTranslatedContent(data.content);
      setExpandedDone(false);
      setTranslated(true);
      setOpen(true);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : t("translation.failed"));
    } finally {
      setTranslating(false);
    }
  }, [translated, translatedContent, item.id, userLocale, toast, t]);

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
        className="animate-fade-in border-b border-border py-10"
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
                <span className="font-semibold">{t("article.pinned")}</span>
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
                <span className="font-semibold">{t("article.unpublished")}</span>
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
        {canTranslate && (
          <button
            onClick={handleTranslate}
            disabled={translating}
            className="mb-2 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1 text-xs text-muted transition-colors hover:text-accent disabled:opacity-50"
            title={translated ? t("translation.showOriginal") : t("translation.show")}
          >
            <Languages className="h-3.5 w-3.5" />
            {translating
              ? t("translation.translating")
              : translated
                ? `${t("translation.translated")} ${t("translation.showOriginal")}`
                : t("translation.show")}
          </button>
        )}
        <h2
          data-caret-title
          className="font-heading text-3xl font-bold leading-tight text-fg"
        >
          <a
            href={articleHref}
            className="transition-colors hover:text-accent"
          >
            {displayTitle}
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

      {!open && !item.previewHtml && (
        <p className="text-lg leading-relaxed text-fg/90">{item.preview}</p>
      )}

      {bodyHtml !== undefined && (
        <div
          ref={articleBodyRef}
          className={`article-body article-rendered text-lg text-fg/90${open && !expandedDone ? " animate-expand overflow-hidden" : ""}`}
          onAnimationEnd={() => setExpandedDone(true)}
          dangerouslySetInnerHTML={bodyMarkup}
        />
      )}

      <div className="mt-4 flex items-center gap-3">
        {!open && (
          <button
            onClick={() => void loadFull()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-accent px-4 py-2 text-sm font-semibold text-accent transition-colors hover:bg-accent hover:text-bg disabled:opacity-50"
          >
            <ChevronDown className="h-4 w-4" />
            {loading ? t("article.loading") : t("article.fullText")}
          </button>
        )}
        {isAdmin && onEdit && (
          <button
            onClick={() => onEdit(item)}
            title={t("article.editArticle")}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm text-muted transition-colors hover:text-fg"
          >
            <Pencil className="h-4 w-4" />
            {t("article.edit")}
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
