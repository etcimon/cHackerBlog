/**
 * Article pin endpoint.
 *   POST -> pins an article (sets pinned=true and pinnedAt=now)
 *   DELETE -> unpins an article (sets pinned=false and pinnedAt=null)
 */
import { handler, ok, Errors } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { invalidate } from "@/lib/cache";

export const runtime = "nodejs";

export const POST = handler(async (req: Request, { params }: { params: { id: string } }) => {
  requireAdmin();
  const article = await prisma.article.findUnique({
    where: { id: params.id },
  });
  if (!article) throw Errors.notFound("Article not found");

  const updated = await prisma.article.update({
    where: { id: params.id },
    data: {
      pinned: true,
      pinnedAt: new Date(),
    },
  });
  // Invalidate feed cache since pin order has changed
  invalidate("feed");
  return ok({ pinned: updated.pinned, pinnedAt: updated.pinnedAt });
});

export const DELETE = handler(async (req: Request, { params }: { params: { id: string } }) => {
  requireAdmin();
  const article = await prisma.article.findUnique({
    where: { id: params.id },
  });
  if (!article) throw Errors.notFound("Article not found");

  const updated = await prisma.article.update({
    where: { id: params.id },
    data: {
      pinned: false,
      pinnedAt: null,
    },
  });
  // Invalidate feed cache since pin order has changed
  invalidate("feed");
  return ok({ pinned: updated.pinned, pinnedAt: updated.pinnedAt });
});
