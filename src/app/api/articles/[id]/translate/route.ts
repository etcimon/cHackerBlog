/**
 * Article translation endpoint.
 *   POST { locale } -> translated { title, content } for the given target locale.
 *
 * Gated on the Grok integration being configured; when it is not, the route
 * reports `enabled: false` so the client simply never renders the affordance.
 * Reads through the translation cache -> ArticleTranslation table -> Grok.
 */
import { z } from "zod";
import { handler, ok, Errors, AppError } from "@/lib/errors";
import { getArticleTranslationSource } from "@/lib/articles";
import { translateArticle } from "@/lib/grok";
import { grokConfigured } from "@/lib/env";
import { isSupportedLocale, type Locale } from "@/lib/i18n";
import { isAdmin } from "@/lib/auth";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  locale: z.custom<Locale>(isSupportedLocale, "Unsupported locale"),
});

export const POST = handler<Ctx>(async (req, { params }) => {
  const { id } = await params;

  if (!grokConfigured()) {
    return ok({ enabled: false as const });
  }

  const json = await req.json().catch(() => ({}));
  const { locale } = bodySchema.parse(json);

  const admin = await isAdmin();
  const source = await getArticleTranslationSource(id, { includeUnpublished: admin });
  if (!source) throw Errors.notFound("Article not found");

  let result;
  try {
    result = await translateArticle({
      articleId: source.id,
      targetLocale: locale,
      title: source.title,
      contentHtml: source.content,
      sourceLocale: source.locale,
    });
  } catch (err) {
    // Upstream (Grok) failure -> 502 Bad Gateway with the real reason so the
    // client toast is actionable (e.g. invalid GROK_MODEL / GROK_API_KEY).
    throw new AppError(
      err instanceof Error ? err.message : "Translation failed",
      502,
      "GROK_ERROR",
    );
  }

  return ok({
    enabled: true as const,
    locale: result.locale,
    title: result.title,
    content: result.content,
  });
});
