"use client";

/**
 * First-run setup screen. Gated behind admin authentication (the same password
 * modal used elsewhere). Once unlocked, presents the global settings form:
 * branding (title/description/favicon/cover/author/thumb), raw <head> HTML, and
 * social accounts + auto-post toggle. Theme/styling is NOT configured here — it
 * is selected via the THEME env var and defined in SCSS (src/styles/themes).
 * Saving marks setup complete and routes to the feed. Built with
 * react-hook-form + the shared zod schema.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { siteSettingsSchema, type SiteSettingsInput } from "@/lib/schemas";
import { api, ApiClientError } from "@/lib/api-client";
import { useAdmin } from "@/components/admin-context";
import { useToast } from "@/components/toast";

type SetupForm = SiteSettingsInput;

const FIELD =
  "w-full rounded border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-accent";

export default function SetupPage() {
  const { isAdmin, ready, login } = useAdmin();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toast = useToast();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SetupForm>({
    resolver: zodResolver(siteSettingsSchema),
    defaultValues: {
      title: "cHackerBlog",
      description: "",
      socialAutopost: false,
    },
  });

  if (!ready) return null;

  if (!isAdmin) {
    const submit = async () => {
      setBusy(true);
      await login(password);
      setBusy(false);
    };
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
        <h1 className="mb-2 font-heading text-3xl font-bold text-fg">cHackerBlog setup</h1>
        <p className="mb-6 text-muted">Enter the admin password to configure your blog.</p>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Admin password"
          className={FIELD}
        />
        <button
          onClick={submit}
          disabled={busy}
          className="mt-4 rounded bg-accent py-2 font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Authenticating…" : "Unlock setup"}
        </button>
      </main>
    );
  }

  const onSubmit = async (values: SetupForm) => {
    try {
      await api.put("/api/settings", values);
      toast.success("Setup complete");
      router.push("/");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Save failed");
    }
  };

  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="mb-8 font-heading text-4xl font-bold text-fg">Configure cHackerBlog</h1>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
        <section className="space-y-3">
          <h2 className="font-heading text-xl font-semibold text-accent">Branding</h2>
          <div>
            <label className="mb-1 block text-sm text-muted">Title</label>
            <input {...register("title")} className={FIELD} />
            {errors.title && <p className="mt-1 text-xs text-red-400">{errors.title.message}</p>}
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted">Description</label>
            <input {...register("description")} className={FIELD} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input {...register("faviconUrl")} placeholder="Favicon URL" className={FIELD} />
            <input {...register("coverUrl")} placeholder="Cover header URL" className={FIELD} />
            <input {...register("authorName")} placeholder="Author name" className={FIELD} />
            <input {...register("authorThumbUrl")} placeholder="Author thumbnail URL" className={FIELD} />
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted">Custom &lt;head&gt; HTML</label>
            <textarea {...register("headHtml")} rows={4} className={FIELD} />
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="font-heading text-xl font-semibold text-accent">Social</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input {...register("xHandle")} placeholder="X handle (e.g. @cimon)" className={FIELD} />
            <input {...register("linkedinUrl")} placeholder="LinkedIn profile URL" className={FIELD} />
          </div>
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" {...register("socialAutopost")} className="accent-accent" />
            Auto-post new articles to X and LinkedIn
          </label>
        </section>

        <section className="space-y-2">
          <h2 className="font-heading text-xl font-semibold text-accent">Theme</h2>
          <p className="text-sm text-muted">
            The visual theme (hacker terminal, medium, or substack) is selected
            with the <code>THEME</code> environment variable and defined in SCSS
            (<code>src/styles/themes</code>). It is no longer configured here.
          </p>
        </section>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded bg-accent py-3 font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {isSubmitting ? "Saving…" : "Save and launch"}
        </button>
      </form>
    </main>
  );
}
