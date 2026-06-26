/**
 * Public feed endpoint. Cursor-paginated, recency-ordered, tag/locale filter.
 * Rate-limited per IP (Cloudflare-aware). The client infinite-scroll prefetches
 * FEED_PREFETCH_PAGES ahead using the returned nextCursor.
 */
import { handler, ok, Errors } from "@/lib/errors";
import { feedQuerySchema } from "@/lib/schemas";
import { getFeed } from "@/lib/articles";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export const GET = handler(async (req: Request) => {
  const ip = getClientIp(req.headers);
  const rl = await rateLimit(ip, "feed");
  if (!rl.allowed) throw Errors.rateLimited();

  const url = new URL(req.url);
  const query = feedQuerySchema.parse({
    cursor: url.searchParams.get("cursor") ?? undefined,
    tag: url.searchParams.get("tag") ?? undefined,
    locale: url.searchParams.get("locale") ?? undefined,
    take: url.searchParams.get("take") ?? undefined,
  });

  const page = await getFeed(query);
  return ok(page);
});
