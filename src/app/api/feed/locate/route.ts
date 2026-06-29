/**
 * Locate endpoint. Given ?slug=, returns a tag-scoped first-load feed slice that
 * already contains the target article plus the index to scroll to. Used for
 * client-side navigations to /article/<slug> that should not full-reload.
 * Rate-limited per IP under the shared "feed" budget.
 */
import { handler, ok, Errors } from "@/lib/errors";
import { locateArticleForFirstLoad } from "@/lib/feed-locator";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { isAdmin } from "@/lib/auth";

export const runtime = "nodejs";

export const GET = handler(async (req: Request) => {
  const ip = getClientIp(req.headers);
  const rl = await rateLimit(ip, "feed");
  if (!rl.allowed) throw Errors.rateLimited();

  const url = new URL(req.url);
  const slug = url.searchParams.get("slug");
  if (!slug) throw Errors.notFound("Missing slug");

  const admin = await isAdmin();
  const result = await locateArticleForFirstLoad(slug, { includeUnpublished: admin });
  return ok(result);
});
