"use client";

/**
 * Comment/reference icon bar shown below each article. Clicking the comment icon
 * toggles an in-place comment form + approved-comment list (loaded on demand).
 */
import { useCallback, useState } from "react";
import { MessageCircle, Share2, Link as LinkIcon, Lock } from "lucide-react";
import { api, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/toast";
import { ShareModal } from "@/components/share-modal";

interface CommentItem {
  id: string;
  authorName: string;
  body: string;
  createdAt: string;
}

interface Props {
  articleId: string;
  slug: string;
  commentsEnabled?: boolean;
  commentCount?: number;
  /** Article metadata used to build the share payload. */
  title?: string;
  seoDescription?: string;
  seoKeywords?: string;
  thumbnailUrl?: string | null;
}

export function CommentBar({
  articleId,
  slug,
  commentsEnabled = true,
  commentCount = 0,
  title = "",
  seoDescription = "",
  seoKeywords = "",
  thumbnailUrl = null,
}: Props) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const toast = useToast();

  const toggle = useCallback(async () => {
    if (!commentsEnabled) {
      toast.info("Comments are disabled");
      return;
    }

    const next = !open;
    setOpen(next);
    if (next && !loaded) {
      try {
        const data = await api.get<CommentItem[]>(
          `/api/comments?articleId=${encodeURIComponent(articleId)}`,
        );
        setComments(data);
      } catch {
        /* non-fatal */
      } finally {
        setLoaded(true);
      }
    }
  }, [open, loaded, articleId, commentsEnabled, toast]);

  const submit = useCallback(async () => {
    if (!body.trim()) return;
    if (!ageConfirmed) {
      toast.error("You must confirm you are 14+ years old");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/api/comments", {
        articleId,
        authorName: name || "anonymous",
        body,
        ageConfirmed,
      });
      setBody("");
      setAgeConfirmed(false);
      toast.success("Comment submitted for moderation");
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Failed to comment");
    } finally {
      setSubmitting(false);
    }
  }, [articleId, name, body, ageConfirmed, toast]);

  // Canonical, crawlable, SEO-friendly article URL (no hash).
  const articleUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/article/${slug}`
      : `/article/${slug}`;

  return (
    <div className="mt-6 border-t border-border pt-4">
      <div className="flex items-center gap-4 text-muted">
        <button
          onClick={toggle}
          className="flex items-center gap-1.5 transition-colors hover:text-accent disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!commentsEnabled}
          title={commentsEnabled ? "Comment" : "Comments are disabled"}
        >
          {commentsEnabled ? (
            <MessageCircle className="h-5 w-5" />
          ) : (
            <Lock className="h-5 w-5" />
          )}
          <span className="text-sm">{commentsEnabled ? `Comment` + (commentCount > 0 ? `s [${commentCount}]` : ``) : "Comments disabled"}</span>
        </button>
        <button
          onClick={() => setShareOpen(true)}
          className="flex items-center gap-1.5 transition-colors hover:text-accent"
        >
          <Share2 className="h-5 w-5" />
          <span className="text-sm">Share</span>
        </button>
        <a
          href={articleUrl}
          className="flex items-center gap-1.5 transition-colors hover:text-accent"
        >
          <LinkIcon className="h-5 w-5" />
          <span className="text-sm">Reference</span>
        </a>
      </div>

      <ShareModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        payload={{
          url: articleUrl,
          title,
          description: seoDescription,
          keywords: seoKeywords,
        }}
        thumbnailUrl={thumbnailUrl}
      />

      {open && commentsEnabled && (
        <div className="mt-4 animate-fade-in space-y-4">
          <div className="space-y-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name (optional)"
              className="w-full rounded border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Leave a comment…"
              rows={3}
              className="w-full rounded border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
            />
            <label className="flex items-start gap-2 text-sm text-fg">
              <input
                type="checkbox"
                checked={ageConfirmed}
                onChange={(e) => setAgeConfirmed(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border bg-bg text-accent focus:ring-accent"
              />
              <span>I confirm that I am 14 years of age or older</span>
            </label>
            <button
              onClick={submit}
              disabled={submitting || !ageConfirmed}
              className="rounded bg-accent px-4 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Submitting…" : "Submit"}
            </button>
          </div>

          <ul className="space-y-3">
            {comments.map((c) => (
              <li key={c.id} className="rounded border border-border bg-card p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted">{c.authorName}</p>
                  <p className="text-xs text-muted">
                    {new Date(c.createdAt).toLocaleDateString()} {new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <p className="text-sm text-fg">{c.body}</p>
              </li>
            ))}
            {loaded && comments.length === 0 && (
              <li className="text-sm text-muted">No comments yet.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
