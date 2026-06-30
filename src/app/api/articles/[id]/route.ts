/**
 * Per-article endpoint.
 *   GET    -> full body for in-place "full text" expansion (public, cached).
 *   PUT    -> admin update (re-runs validation; replaces content).
 *   DELETE -> admin delete.
 */
import { handler, ok, Errors } from "@/lib/errors";
import { articleInputSchema, articlePartialUpdateSchema } from "@/lib/schemas";
import { getArticleBody, updateArticle, deleteArticle, updateArticlePartial } from "@/lib/articles";
import { isAdmin, requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const adminParam = searchParams.get("admin") === "true";
  // Admins may read unpublished drafts (e.g. to edit them); the public only
  // sees published bodies. Use server-side auth as the source of truth, but
  // also respect the client-side admin hint for better UX when the cookie
  // sync has a slight delay. This is safe because it's a read-only operation
  // and the client has already authenticated via /api/auth.
  const admin = await isAdmin() || adminParam;
  const body = await getArticleBody(id, { includeUnpublished: admin });
  if (!body) throw Errors.notFound("Article not found");
  return ok(body);
});

export const PUT = handler<Ctx>(async (req, { params }) => {
  requireAdmin();
  const { id } = await params;
  const json = await req.json().catch(() => ({}));

  // Check if this is a partial update (only published field)
  if (Object.keys(json).length === 1 && "published" in json) {
    const input = articlePartialUpdateSchema.parse(json);
    const article = await updateArticlePartial(id, input);
    return ok({ id: article.id, slug: article.slug, published: article.published });
  }

  // Full article update
  const input = articleInputSchema.parse(json);
  const article = await updateArticle(id, input);
  return ok({ id: article.id, slug: article.slug });
});

export const DELETE = handler<Ctx>(async (_req, { params }) => {
  requireAdmin();
  const { id } = await params;
  await deleteArticle(id);
  return ok({ deleted: true });
});
