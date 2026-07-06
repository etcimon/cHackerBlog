"use client";

/**
 * Floating admin control. When unauthenticated, the "Admin" link opens a
 * password modal (replaces nothing else on the page). When authenticated, it
 * exposes "New article", "Moderate comments", and "Sign out".
 */
import { useState } from "react";
import { Lock, Plus, LogOut, X, MessageSquare, Check, X as XIcon, Settings } from "lucide-react";
import { useAdmin } from "@/components/admin-context";
import { api, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/toast";
import { useI18n } from "@/lib/use-i18n";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { siteSettingsSchema, type SiteSettingsInput } from "@/lib/schemas";
import { SUPPORTED_LOCALES } from "@/lib/i18n";

export function AdminBar({ onNewArticle }: { onNewArticle: () => void }) {
  const { isAdmin, ready, login, logout } = useAdmin();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [moderateOpen, setModerateOpen] = useState(false);
  const [pendingComments, setPendingComments] = useState<any[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const toast = useToast();
  const { t } = useI18n();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SiteSettingsInput>({
    resolver: zodResolver(siteSettingsSchema),
    defaultValues: {
      title: "",
      description: "",
      socialAutopost: false,
      defaultLocale: "en",
      translationMode: "default",
    },
  });

  if (!ready) return null;

  const submit = async () => {
    setBusy(true);
    const okLogin = await login(password);
    setBusy(false);
    if (okLogin) {
      setPassword("");
      setOpen(false);
    }
  };

  const loadPendingComments = async () => {
    setLoadingComments(true);
    try {
      const comments = await api.get<any[]>("/api/comments/admin");
      setPendingComments(comments);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : t("admin.failedLoadComments"));
    } finally {
      setLoadingComments(false);
    }
  };

  const moderateComment = async (commentId: string, approved: boolean) => {
    try {
      await api.patch("/api/comments/admin", { commentId, approved });
      setPendingComments(pendingComments.filter(c => c.id !== commentId));
      toast.success(approved ? t("admin.commentApproved") : t("admin.commentRejected"));
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : t("admin.failedModerate"));
    }
  };

  const openModeration = () => {
    setModerateOpen(true);
    loadPendingComments();
  };

  const openSettings = async () => {
    setSettingsOpen(true);
    setLoadingSettings(true);
    try {
      const settings = await api.get<any>("/api/settings");
      reset({
        title: settings.title || "",
        description: settings.description || "",
        faviconUrl: settings.faviconUrl || "",
        coverUrl: settings.coverUrl || "",
        authorName: settings.authorName || "",
        authorThumbUrl: settings.authorThumbUrl || "",
        headHtml: settings.headHtml || "",
        xHandle: settings.xHandle || "",
        linkedinUrl: settings.linkedinUrl || "",
        socialAutopost: settings.socialAutopost || false,
        defaultLocale: settings.defaultLocale || "en",
        translationMode: settings.translationMode || "default",
      });
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : t("admin.failedLoadSettings"));
    } finally {
      setLoadingSettings(false);
    }
  };

  const saveSettings = async (values: SiteSettingsInput) => {
    try {
      await api.put("/api/settings", values);
      toast.success(t("admin.settingsSaved"));
      setSettingsOpen(false);
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : t("admin.failedSaveSettings"));
    }
  };

  return (
    <>
      <div className="fixed bottom-4 left-4 z-40 flex items-center gap-2">
        {isAdmin ? (
          <>
            <button
              onClick={onNewArticle}
              title={t("article.newArticle")}
              className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg shadow-lg transition-opacity hover:opacity-90"
            >
              <Plus className="h-4 w-4" /> {t("article.newArticle")}
            </button>
            <button
              onClick={openModeration}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-2 text-sm text-muted shadow-lg transition-colors hover:text-fg"
            >
              <MessageSquare className="h-4 w-4" /> {t("admin.moderate")}
            </button>
            <button
              onClick={openSettings}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-2 text-sm text-muted shadow-lg transition-colors hover:text-fg"
            >
              <Settings className="h-4 w-4" />
            </button>
            <button
              onClick={() => void logout()}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-2 text-sm text-muted shadow-lg transition-colors hover:text-fg"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </>
        ) : (
          <button
            onClick={() => setOpen(true)}
            title={t("admin.admin")}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm text-muted shadow-lg transition-colors hover:text-fg"
          >
            <Lock className="h-4 w-4" /> {t("admin.admin")}
          </button>
        )}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 animate-fade-in"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-heading text-lg font-bold text-fg">{t("admin.adminAccess")}</h3>
              <button onClick={() => setOpen(false)} className="text-muted hover:text-fg">
                <X className="h-5 w-5" />
              </button>
            </div>
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder={t("admin.password")}
              className="w-full rounded border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-accent"
            />
            <button
              type="submit"
              onClick={submit}
              disabled={busy}
              className="mt-4 w-full rounded bg-accent py-2 font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? t("admin.authenticating") : t("admin.unlock")}
            </button>
          </div>
        </div>
      )}

      {moderateOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 animate-fade-in"
          onClick={() => setModerateOpen(false)}
        >
          <div
            className="w-full max-w-2xl max-h-[80vh] rounded-lg border border-border bg-card p-6 shadow-2xl overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-heading text-lg font-bold text-fg">{t("admin.moderateComments")}</h3>
              <button onClick={() => setModerateOpen(false)} className="text-muted hover:text-fg">
                <X className="h-5 w-5" />
              </button>
            </div>
            
            {loadingComments ? (
              <p className="text-muted">{t("admin.loadingComments")}</p>
            ) : pendingComments.length === 0 ? (
              <p className="text-muted">{t("admin.noPendingComments")}</p>
            ) : (
              <div className="space-y-4">
                {pendingComments.map((comment) => (
                  <div key={comment.id} className="rounded border border-border bg-bg p-4">
                    <div className="mb-2 flex items-start justify-between">
                      <div>
                        <p className="text-sm font-semibold text-fg">{comment.authorName}</p>
                        <p className="text-xs text-muted">{comment.article?.title || 'Unknown article'}</p>
                        <p className="text-xs text-muted">
                          Score: {comment.acceptabilityScore || 'N/A'}
                          {comment.validationReasons && ` | Reasons: ${JSON.parse(comment.validationReasons).join(', ')}`}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => moderateComment(comment.id, true)}
                          className="rounded bg-accent px-3 py-1 text-sm text-bg hover:opacity-90"
                        >
                          <Check className="h-4 w-4 inline" /> {t("admin.approve")}
                        </button>
                        <button
                          onClick={() => moderateComment(comment.id, false)}
                          className="rounded border border-border px-3 py-1 text-sm text-muted hover:text-fg"
                        >
                          <XIcon className="h-4 w-4 inline" /> {t("admin.reject")}
                        </button>
                      </div>
                    </div>
                    <p className="text-sm text-fg whitespace-pre-wrap">{comment.body}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {settingsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 animate-fade-in"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            className="w-full max-w-2xl max-h-[80vh] rounded-lg border border-border bg-card p-6 shadow-2xl overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-heading text-lg font-bold text-fg">{t("admin.siteSettings")}</h3>
              <button onClick={() => setSettingsOpen(false)} className="text-muted hover:text-fg">
                <X className="h-5 w-5" />
              </button>
            </div>

            {loadingSettings ? (
              <p className="text-muted">{t("admin.loadingSettings")}</p>
            ) : (
              <form onSubmit={handleSubmit(saveSettings)} className="space-y-4">
                <div className="space-y-3">
                  <h4 className="font-heading text-sm font-semibold text-accent">{t("admin.branding")}</h4>
                  <div>
                    <label className="mb-1 block text-sm text-muted">{t("admin.titleLabel")}</label>
                    <input {...register("title")} className="w-full rounded border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-accent" />
                    {errors.title && <p className="mt-1 text-xs text-red-400">{errors.title.message}</p>}
                  </div>
                  <div>
                    <label className="mb-1 block text-sm text-muted">{t("admin.descriptionLabel")}</label>
                    <input {...register("description")} className="w-full rounded border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-accent" />
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <input {...register("faviconUrl")} placeholder={t("admin.faviconUrlPlaceholder")} className="w-full rounded border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-accent" />
                    <input {...register("coverUrl")} placeholder={t("admin.coverHeaderUrlPlaceholder")} className="w-full rounded border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-accent" />
                    <input {...register("authorName")} placeholder={t("admin.authorNamePlaceholder")} className="w-full rounded border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-accent" />
                    <input {...register("authorThumbUrl")} placeholder={t("admin.authorThumbUrlPlaceholder")} className="w-full rounded border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-accent" />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm text-muted">{t("admin.customHeadHtml")}</label>
                    <textarea {...register("headHtml")} rows={4} className="w-full rounded border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-accent" />
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="font-heading text-sm font-semibold text-accent">{t("admin.social")}</h4>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <input {...register("xHandle")} placeholder={t("admin.xHandlePlaceholder")} className="w-full rounded border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-accent" />
                    <input {...register("linkedinUrl")} placeholder={t("admin.linkedinUrlPlaceholder")} className="w-full rounded border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-accent" />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-muted">
                    <input type="checkbox" {...register("socialAutopost")} className="accent-accent" />
                    {t("admin.autoPostLabel")}
                  </label>
                </div>

                <div className="space-y-3">
                  <h4 className="font-heading text-sm font-semibold text-accent">{t("admin.language")}</h4>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm text-muted">{t("admin.defaultLanguageLabel")}</label>
                      <select {...register("defaultLocale")} className="w-full rounded border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-accent">
                        {SUPPORTED_LOCALES.map((l) => (
                          <option key={l.code} value={l.code}>
                            {l.label} ({l.nativeName})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm text-muted">{t("admin.translationModeLabel")}</label>
                      <select {...register("translationMode")} className="w-full rounded border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-accent">
                        <option value="default">{t("admin.translationDefault")}</option>
                        <option value="user-specific">{t("admin.translationUserSpecific")}</option>
                      </select>
                    </div>
                  </div>
                  <p className="text-xs text-muted">
                    {t("admin.languageHelpText")}
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full rounded bg-accent py-2 font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {isSubmitting ? t("common.saving") : t("admin.saveSettings")}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
