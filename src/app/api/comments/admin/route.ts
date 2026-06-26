/**
 * Admin comment moderation endpoints.
 *   GET  -> list pending comments for moderation.
 *   PATCH -> approve/reject a comment.
 */
import { handler, ok, Errors } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

// GET pending comments for admin moderation
export const GET = handler(async (req: Request) => {
  requireAdmin();

  const url = new URL(req.url);
  const articleId = url.searchParams.get("articleId");

  const where = articleId ? { articleId, approved: false } : { approved: false };
  const comments = await prisma.comment.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      article: {
        select: { title: true, slug: true },
      },
    },
  });

  return ok(comments);
});

// PATCH to approve/reject comment (admin only)
export const PATCH = handler(async (req: Request) => {
  requireAdmin();

  const body = await req.json().catch(() => ({}));
  const { commentId, approved } = body;

  if (!commentId || typeof approved !== "boolean") {
    throw Errors.notFound("commentId and approved status required");
  }

  const comment = await prisma.comment.update({
    where: { id: commentId },
    data: { approved },
  });

  return ok(comment);
});
