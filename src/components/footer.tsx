"use client";

/**
 * Site footer. Per branding requirement, the single-word product name is
 * "cHackerBlog", shown here and linked to the source repository.
 *
 * Also manages legal pages (Terms & Conditions, Privacy Policy):
 *  - Admin sees faint links at the top-right when the articles are empty/missing;
 *    clicking opens the WYSIWYG editor to create/edit them.
 *  - Public sees faint links at the top-right only when the articles exist,
 *    are published, and have content; clicking opens a read-only modal.
 */
import { useCallback, useEffect, useState } from "react";
import { Github, X } from "lucide-react";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useAdmin } from "@/components/admin-context";
import { useI18n } from "@/lib/use-i18n";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { useToast } from "@/components/toast";
import { api, ApiClientError } from "@/lib/api-client";
import { Wysiwyg } from "@/components/wysiwyg";

type LegalStatus = Record<
  string,
  { exists: boolean; published: boolean; hasContent: boolean }
>;

type LegalArticle = {
  id: string;
  slug: string;
  title: string;
  content: string;
  published: boolean;
  translated?: boolean;
};

const LEGAL_SLUGS = ["terms-conditions", "privacy-policy"] as const;

export function Footer({
  xHandle,
  linkedinUrl,
}: {
  xHandle?: string | null;
  linkedinUrl?: string | null;
}) {
  const { isAdmin } = useAdmin();
  const { locale, t } = useI18n();
  const toast = useToast();
  const [status, setStatus] = useState<LegalStatus | null>(null);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [readingSlug, setReadingSlug] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editPublished, setEditPublished] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [readingArticle, setReadingArticle] = useState<LegalArticle | null>(null);
  const [loadingRead, setLoadingRead] = useState(false);
  const [showTopRight, setShowTopRight] = useState(false);

  // Fetch legal status on mount and when admin status changes
  const refreshStatus = useCallback(async () => {
    try {
      const s = await api.get<LegalStatus>("/api/legal");
      setStatus(s);
    } catch {
      // silently ignore — legal links are non-critical
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus, isAdmin]);

  // Show the top-right controls only when more than 1 article is on the page
  useEffect(() => {
    const check = () => {
      const count = document.querySelectorAll('[data-testid="article-card"]').length;
      setShowTopRight(count > 1);
    };
    check();
    // Re-check after a short delay for client-rendered content
    const timer = setTimeout(check, 2000);
    // Also observe DOM additions so we catch article cards whenever they appear
    const observer = new MutationObserver(() => check());
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  // Open admin editor for a legal slug. When the admin's selected locale
  // differs from the base article's locale, the editor loads the translation
  // for that locale (or an empty shell if none exists yet). Saving upserts
  // the translation row via the locale parameter on the PUT endpoint.
  const openEditor = useCallback(
    async (slug: string) => {
      setEditingSlug(slug);
      setEditContent("");
      setEditPublished(true);
      try {
        const params = locale !== DEFAULT_LOCALE ? `?locale=${locale}` : "";
        const article = await api.get<LegalArticle>(
          `/api/legal/${slug}${params}`,
        );
        setEditTitle(article.title);
        setEditContent(article.content);
        setEditPublished(article.published);
      } catch {
        // Not found — pre-fill with a default title
        setEditTitle(
          slug === "terms-conditions" ? "Terms & Conditions" : "Privacy Policy",
        );
      }
    },
    [locale],
  );

  // Save legal article. When the admin's selected locale differs from the
  // base article's locale, the locale is sent so the PUT endpoint upserts a
  // translation row instead of modifying the base article.
  const handleSave = useCallback(async () => {
    if (!editingSlug) return;
    setSubmitting(true);
    try {
      await api.put(`/api/legal/${editingSlug}`, {
        title: editTitle,
        content: editContent,
        published: editPublished,
        ...(locale !== DEFAULT_LOCALE ? { locale } : {}),
      });
      toast.success("Saved");
      setEditingSlug(null);
      void refreshStatus();
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : "Save failed",
      );
    } finally {
      setSubmitting(false);
    }
  }, [editingSlug, editTitle, editContent, editPublished, toast, refreshStatus, locale]);

  // Open public read modal. Passes the visitor's locale so the server can
  // return a translated version when one exists, falling back to the default.
  const openReader = useCallback(async (slug: string) => {
    setReadingSlug(slug);
    setLoadingRead(true);
    setReadingArticle(null);
    try {
      const params = locale !== DEFAULT_LOCALE ? `?locale=${locale}` : "";
      const article = await api.get<LegalArticle>(`/api/legal/${slug}${params}`);
      setReadingArticle(article);
    } catch {
      setReadingSlug(null);
    } finally {
      setLoadingRead(false);
    }
  }, [locale]);

  // Determine visibility for each slug
  const links = LEGAL_SLUGS.map((slug) => {
    const s = status?.[slug];
    const isReady = s?.exists && s.published && s.hasContent;
    const label =
      slug === "terms-conditions" ? t("legal.terms") : t("legal.privacy");
    return { slug, label, isReady: !!isReady };
  });

  return (
    <>
      {/* Top-right controls: language switcher + legal links + github */}
      {showTopRight && (() => {
        const visibleLinks = links.filter((l) => isAdmin || l.isReady);
        const hasVisibleLinks = visibleLinks.length > 0;
        return (
      <div className="absolute right-3 top-3 z-30 flex items-center gap-2 text-[10px] text-muted/40">
        <LanguageSwitcher />
        {hasVisibleLinks && <span className="text-muted/30">·</span>}
        {links.map(({ slug, label, isReady }, idx) => {
          // Admin: always show and always open the editor
          if (isAdmin) {
            return (
              <span key={slug} className="flex items-center gap-2">
                {idx > 0 && <span className="text-muted/30">·</span>}
                <button
                  onClick={() => openEditor(slug)}
                  className="transition-colors hover:text-muted"
                  title={`Edit ${label}`}
                >
                  {label}
                </button>
              </span>
            );
          }
          // Public: show if ready (published + has content)
          if (isReady) {
            return (
              <span key={slug} className="flex items-center gap-2">
                {idx > 0 && <span className="text-muted/30">·</span>}
                <button
                  onClick={() => openReader(slug)}
                  className="transition-colors hover:text-muted"
                >
                  {label}
                </button>
              </span>
            );
          }
          return null;
        })}
        {hasVisibleLinks && <span className="text-muted/30">·</span>}
        <a
          href="https://github.com/etcimon/chackerblog"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center transition-colors hover:text-muted"
          title="cHackerBlog"
        >
          <Github className="h-3 w-3" />
        </a>
      </div>
        );
      })()}

      <footer className="mt-16 border-t border-border py-8 text-center text-sm text-muted">
        <div className="mb-3 flex items-center justify-center gap-4">
          <LanguageSwitcher />
          {(isAdmin || links.some((l) => l.isReady)) && <span className="text-muted/30">·</span>}
          {links.map(({ slug, label, isReady }, idx) => {
            if (isAdmin) {
              return (
                <span key={slug} className="flex items-center gap-2">
                  {idx > 0 && <span className="text-muted/30">·</span>}
                  <button
                    onClick={() => openEditor(slug)}
                    className="transition-colors hover:text-accent"
                  >
                    {label}
                  </button>
                </span>
              );
            }
            if (isReady) {
              return (
                <span key={slug} className="flex items-center gap-2">
                  {idx > 0 && <span className="text-muted/30">·</span>}
                  <button
                    onClick={() => openReader(slug)}
                    className="transition-colors hover:text-accent"
                  >
                    {label}
                  </button>
                </span>
              );
            }
            return null;
          })}
          {xHandle && (
            <a
              href={`https://x.com/${xHandle.replace(/^@/, "")}`}
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-accent"
            >
              X / @{xHandle.replace(/^@/, "")}
            </a>
          )}
          {linkedinUrl && (
            <a
              href={linkedinUrl}
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-accent"
            >
              LinkedIn
            </a>
          )}
        </div>
        <p className="flex items-center justify-center gap-1.5">
          {t("common.poweredBy")}{" "}
          <a
            href="https://github.com/etcimon/chackerblog"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-accent transition-opacity hover:opacity-80"
          >
            <Github className="h-4 w-4" />
            cHackerBlog
          </a>
        </p>
      </footer>

      {/* Admin legal editor modal */}
      {editingSlug && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 animate-fade-in">
          <div className="my-8 w-full max-w-3xl rounded-lg border border-border bg-card p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-heading text-xl font-bold text-fg">
                {editingSlug === "terms-conditions"
                  ? t("legal.terms")
                  : t("legal.privacy")}
              </h3>
              <button
                onClick={() => setEditingSlug(null)}
                className="text-muted transition-colors hover:text-fg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mb-4">
              <label className="mb-1 block text-sm text-muted">{t("legal.title")}</label>
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="w-full rounded-md border border-border bg-bg px-3 py-2 text-fg"
              />
            </div>
            <div className="mb-4">
              <label className="mb-1 block text-sm text-muted">{t("legal.content")}</label>
              <Wysiwyg value={editContent} onChange={setEditContent} />
            </div>
            <div className="mb-4 flex items-center gap-2">
              <label className="flex items-center gap-2 text-sm text-muted">
                <input
                  type="checkbox"
                  checked={editPublished}
                  onChange={(e) => setEditPublished(e.target.checked)}
                />
                {t("legal.published")}
              </label>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setEditingSlug(null)}
                className="rounded-md border border-border px-4 py-2 text-sm text-muted transition-colors hover:text-fg"
              >
                {t("legal.cancel")}
              </button>
              <button
                onClick={handleSave}
                disabled={submitting}
                className="rounded-md border border-accent bg-accent px-4 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? t("legal.saving") : t("legal.save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Public legal read modal */}
      {readingSlug && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 animate-fade-in"
          onClick={() => {
            setReadingSlug(null);
            setReadingArticle(null);
          }}
        >
          <div
            className="my-8 w-full max-w-3xl rounded-lg border border-border bg-card p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-heading text-xl font-bold text-fg">
                {readingArticle?.title ??
                  (readingSlug === "terms-conditions"
                    ? t("legal.terms")
                    : t("legal.privacy"))}
              </h3>
              <button
                onClick={() => {
                  setReadingSlug(null);
                  setReadingArticle(null);
                }}
                className="text-muted transition-colors hover:text-fg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {loadingRead ? (
              <p className="py-10 text-center text-muted">{t("legal.loading")}</p>
            ) : readingArticle ? (
              <div
                className="article-body article-rendered text-lg text-fg/90"
                dangerouslySetInnerHTML={{ __html: readingArticle.content }}
              />
            ) : (
              <p className="py-10 text-center text-muted">{t("legal.noContent")}</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
