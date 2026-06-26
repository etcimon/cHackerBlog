/**
 * Comments endpoint.
 *   GET  -> approved comments for an article (?articleId=...).
 *   POST -> submit a comment (rate-limited per IP, stores IP for moderation).
 */
import { handler, ok, Errors } from "@/lib/errors";
import { commentInputSchema } from "@/lib/schemas";
import { prisma } from "@/lib/prisma";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { env } from "@/lib/env";
import { validateComment } from "@/lib/comment-validation";

export const runtime = "nodejs";

export const GET = handler(async (req: Request) => {
  if (!env.COMMENTS_ENABLED) {
    throw Errors.forbidden("Comments are disabled");
  }

  const url = new URL(req.url);
  const articleId = url.searchParams.get("articleId");
  if (!articleId) throw Errors.notFound("articleId required");
  const comments = await prisma.comment.findMany({
    where: { articleId, approved: true },
    orderBy: { createdAt: "desc" },
    select: { id: true, authorName: true, body: true, createdAt: true },
  });
  return ok(comments);
});

export const POST = handler(async (req: Request) => {
  if (!env.COMMENTS_ENABLED) {
    throw Errors.forbidden("Comments are disabled");
  }

  const ip = getClientIp(req.headers);
  const rl = await rateLimit(ip, "comment", { max: 5, windowSeconds: 300 });
  if (!rl.allowed) throw Errors.rateLimited("Comment rate limit reached");

  const body = await req.json().catch(() => ({}));
  const input = commentInputSchema.parse(body);

  const article = await prisma.article.findUnique({
    where: { id: input.articleId },
    select: { id: true },
  });
  if (!article) throw Errors.notFound("Article not found");

  // Check if this IP has already commented on this article
  const existingComment = await prisma.comment.findFirst({
    where: {
      articleId: input.articleId,
      ip,
    },
  });
  if (existingComment) {
    throw Errors.conflict("You have already commented on this article");
  }

  // Validate comment with anti-spam/abuse detection
  const userAgent = req.headers.get("user-agent") || undefined;
  const validation = await validateComment({
    authorName: input.authorName,
    body: input.body,
    email: input.email,
    ip,
    userAgent,
    ageConfirmed: input.ageConfirmed,
  });

  if (!validation.accepted) {
    throw Errors.conflict(
      `Comment rejected: ${validation.reasons.join(", ")} (acceptability score: ${validation.score})`
    );
  }

  await prisma.comment.create({
    data: {
      articleId: input.articleId,
      authorName: input.authorName,
      email: input.email || null,
      body: input.body,
      ip,
      approved: false,
      // @ts-ignore - Fields will be added after migration
      ageConfirmed: input.ageConfirmed,
      acceptabilityScore: validation.score,
      validationReasons: JSON.stringify(validation.reasons),
    },
  });

  return ok({ pending: true, score: validation.score }, 201);
});
