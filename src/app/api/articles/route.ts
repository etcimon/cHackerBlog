/**
 * Article collection endpoint.
 *   POST -> admin creates an article (WYSIWYG submit). On publish, triggers
 *           best-effort social auto-posting (X + LinkedIn).
 */
import { handler, ok } from "@/lib/errors";
import { articleInputSchema } from "@/lib/schemas";
import { createArticle } from "@/lib/articles";
import { requireAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { autopostArticle } from "@/lib/social";

export const runtime = "nodejs";

export const POST = handler(async (req: Request) => {
  requireAdmin();
  const body = await req.json().catch(() => ({}));
  const input = articleInputSchema.parse(body);

  const article = await createArticle(input);

  let social = { x: null as string | null, linkedin: null as string | null };
  if (article.published) {
    const settings = await getSettings();
    social = await autopostArticle(
      { title: article.title, preview: article.preview, slug: article.slug },
      settings.socialAutopost,
    );
  }

  return ok({ id: article.id, slug: article.slug, social }, 201);
});
