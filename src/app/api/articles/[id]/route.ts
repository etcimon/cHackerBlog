/**
 * Per-article endpoint.
 *   GET    -> full body for in-place "full text" expansion (public, cached).
 *   PUT    -> admin update (re-runs validation; replaces content).
 *   DELETE -> admin delete.
 */
import { handler, ok, Errors } from "@/lib/errors";
import { articleInputSchema } from "@/lib/schemas";
import { getArticleBody, updateArticle, deleteArticle } from "@/lib/articles";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler<Ctx>(async (_req, { params }) => {
  const { id } = await params;
  const body = await getArticleBody(id);
  if (!body) throw Errors.notFound("Article not found");
  return ok(body);
});

export const PUT = handler<Ctx>(async (req, { params }) => {
  requireAdmin();
  const { id } = await params;
  const json = await req.json().catch(() => ({}));
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
