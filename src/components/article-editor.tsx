"use client";

/**
 * Admin article editor modal (create + edit). Uses react-hook-form with the
 * shared zod schema (articleInputSchema) for client validation, the Wysiwyg for
 * rich content, and posts to the API. On edit, fetches the full body first.
 */
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { X, Plus } from "lucide-react";
import { articleInputSchema, type ArticleInput } from "@/lib/schemas";
import type { FeedItem, TagItem } from "@/lib/types";
import { api, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/toast";
import { useI18n } from "@/lib/use-i18n";
import { Wysiwyg } from "@/components/wysiwyg";

interface Props {
  article: FeedItem | null;
  allTags: TagItem[];
  onClose: () => void;
  onSaved: () => void;
}

export function ArticleEditor({ article, allTags, onClose, onSaved }: Props) {
  const toast = useToast();
  const { t } = useI18n();
  const isEdit = Boolean(article);
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showAddTagModal, setShowAddTagModal] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [localTags, setLocalTags] = useState<TagItem[]>(allTags);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<ArticleInput>({
    resolver: zodResolver(articleInputSchema),
    defaultValues: {
      title: article?.title ?? "",
      content: "",
      coverUrl: article?.coverUrl ?? "",
      locale: article?.locale ?? "en",
      published: article?.published ?? true,
      tags: article?.tags ?? [],
    },
  });

  // Load full body when editing an existing article. Keyed on the article id
  // only (not the whole object or toast identity) so it fetches exactly once per
  // opened article and never loops if the request fails.
  const articleId = article?.id;
  useEffect(() => {
    if (!articleId) return;
    let cancelled = false;
    api
      .get<{ content: string }>(`/api/articles/${articleId}`)
      .then((d) => {
        if (cancelled) return;
        setContent(d.content);
        setValue("content", d.content);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Failed to load article:", err);
        toast.error(err instanceof ApiClientError ? err.message : t("article.failedLoad"));
      });
    return () => {
      cancelled = true;
    };
  }, [articleId]);

  // Sync localTags with allTags prop when it changes
  useEffect(() => {
    setLocalTags(allTags);
  }, [allTags]);

  const tags = watch("tags");

  const toggleTag = (name: string) => {
    const set = new Set(tags);
    set.has(name) ? set.delete(name) : set.add(name);
    setValue("tags", Array.from(set));
  };

  const addNewTag = () => {
    if (newTagName.trim()) {
      const slug = newTagName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      // Store the original name, not the slug
      toggleTag(newTagName.trim());
      // Add the new tag to local tags list
      setLocalTags([...localTags, { name: newTagName.trim(), slug }]);
      setNewTagName("");
      setShowAddTagModal(false);
    }
  };

  const onSubmit = async (values: ArticleInput) => {
    setSubmitting(true);
    try {
      if (isEdit && article) {
        const result = await api.put<{ deleted?: boolean }>(`/api/articles/${article.id}`, values);
        if (result.deleted) {
          toast.success(t("article.articleDeleted"));
          reset();
          onSaved();
          return;
        }
        toast.success(t("article.articleUpdated"));
      } else {
        await api.post("/api/articles", values);
        toast.success(t("article.articlePublished"));
      }
      reset();
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : t("article.saveFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 animate-fade-in">
      <div className="my-8 w-full max-w-3xl rounded-lg border border-border bg-card p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-heading text-xl font-bold text-fg">
            {isEdit ? t("article.editArticle") : t("article.newArticle")}
          </h3>
          <button onClick={onClose} className="text-muted hover:text-fg">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <input
              {...register("title")}
              placeholder={t("article.titlePlaceholder")}
              className="w-full rounded border border-border bg-bg px-3 py-2 text-lg text-fg outline-none focus:border-accent"
            />
            {errors.title && (
              <p className="mt-1 text-xs text-red-400">{errors.title.message}</p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <input
              {...register("coverUrl")}
              placeholder={t("article.coverUrlPlaceholder")}
              className="w-full rounded border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
            />
            <input
              {...register("locale")}
              placeholder={t("article.localePlaceholder")}
              className="w-full rounded border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {localTags.map((t) => (
              <div
                key={t.slug}
                className={`flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition-colors ${
                  tags.includes(t.name)
                    ? "border-accent bg-accent text-bg"
                    : "border-border text-muted hover:text-fg"
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleTag(t.name)}
                  className="hover:opacity-70"
                >
                  #{t.name}
                </button>
                {tags.includes(t.name) && (
                  <button
                    type="button"
                    onClick={() => toggleTag(t.name)}
                    className="hover:opacity-70"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setShowAddTagModal(true)}
              className="flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1 text-xs text-muted hover:text-fg"
            >
              <Plus className="h-3 w-3" />
              {t("article.addTag")}
            </button>
          </div>

          <Wysiwyg
            value={content}
            onChange={(html) => setValue("content", html)}
          />

          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" {...register("published")} className="accent-accent" />
            {t("article.publishedLabel")}
          </label>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-border px-4 py-2 text-sm text-muted hover:text-fg"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded bg-accent px-5 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? t("common.saving") : isEdit ? t("article.update") : t("article.publish")}
            </button>
          </div>
        </form>
      </div>

      {showAddTagModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-2xl">
            <h3 className="mb-4 font-heading text-lg font-bold text-fg">{t("article.addNewTag")}</h3>
            <input
              type="text"
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              placeholder={t("article.tagNamePlaceholder")}
              className="w-full rounded border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-accent"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addNewTag();
                }
              }}
            />
            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowAddTagModal(false);
                  setNewTagName("");
                }}
                className="rounded border border-border px-4 py-2 text-sm text-muted hover:text-fg"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={addNewTag}
                className="rounded bg-accent px-4 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90"
              >
                {t("article.add")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
