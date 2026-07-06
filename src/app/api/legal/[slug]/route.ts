/**
 * Per-legal-article endpoint.
 *   GET -> public read (published, non-empty articles only).
 *   PUT -> admin create-or-update by slug (forces the canonical slug).
 */
import { z } from "zod";
import { handler, ok, Errors } from "@/lib/errors";
import { getLegalArticle, createOrUpdateLegalArticle, upsertLegalTranslation } from "@/lib/articles";
import { isAdmin, requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

export const GET = handler<Ctx>(async (req, { params }) => {
  const { slug } = await params;
  const admin = await isAdmin();
  const locale = new URL(req.url).searchParams.get("locale") || undefined;
  const article = await getLegalArticle(slug, { includeUnpublished: admin, locale });
  if (!article) {
    // For admins, return an empty shell so the editor can pre-fill;
    // for public, return 404.
    if (admin) {
      return ok({
        id: "",
        slug,
        title: slug === "terms-conditions" ? "Terms & Conditions" : "Privacy Policy",
        content: "",
        published: false,
        translated: false,
      });
    }
    throw Errors.notFound("Legal article not found");
  }
  return ok(article);
});

const legalInputSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  content: z.string().default(""),
  published: z.boolean().default(true),
  locale: z.string().optional(),
});

export const PUT = handler<Ctx>(async (req, { params }) => {
  await requireAdmin();
  const { slug } = await params;
  const json = await req.json().catch(() => ({}));
  const input = legalInputSchema.parse(json);

  // When a locale is provided and it differs from the base article's locale,
  // upsert a translation row instead of modifying the base article.
  if (input.locale) {
    const translation = await upsertLegalTranslation(slug, input.locale, {
      title: input.title,
      content: input.content,
    });
    if (translation === null) {
      return ok({ deleted: true });
    }
    return ok({ id: translation.articleId, slug, locale: input.locale });
  }

  const article = await createOrUpdateLegalArticle(slug, input);
  if (article === null) {
    return ok({ deleted: true });
  }
  return ok({ id: article.id, slug: article.slug });
});
