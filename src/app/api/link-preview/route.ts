/**
 * Link-preview metadata endpoint.
 *
 * GET /api/link-preview?url=<external http(s) URL>
 *
 * Fetches the target page and extracts Open Graph / Twitter Card / <title>
 * metadata for the generic link-embed card (thumbnail, title, description,
 * site name). Recognized platform URLs (YouTube, SoundCloud, …) never reach
 * this endpoint — they render deterministically via `ext-embeds` — so this is
 * strictly the fallback path.
 *
 * Safety:
 *  - IP-rate-limited (scope "linkpreview") to blunt abuse,
 *  - SSRF-guarded: only http(s), and the resolved address must be public
 *    (private / loopback / link-local ranges are rejected),
 *  - response is capped in size and time, and only text/html is parsed.
 */
import { handler, ok, AppError, Errors } from "@/lib/errors";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { assertSafeUrl, fetchWithSafeRedirects, parseHtmlMeta, type LinkPreview } from "@/lib/link-preview";

export const runtime = "nodejs";

/** Max bytes of HTML we will read before bailing (metadata lives in <head>). */
const MAX_BYTES = 512 * 1024;
/** Fetch timeout. */
const TIMEOUT_MS = 6000;

export const GET = handler(async (req: Request) => {
  const ip = getClientIp(req.headers);
  const rl = await rateLimit(ip, "linkpreview", { max: 30, windowSeconds: 60 });
  if (!rl.allowed) throw Errors.rateLimited();

  const raw = new URL(req.url).searchParams.get("url");
  if (!raw) throw new AppError("Missing url parameter", 400, "MISSING_URL");

  const target = await assertSafeUrl(raw);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let res: Response;
    let finalUrl: URL;
    try {
      // Redirects are followed manually so every hop is SSRF re-validated.
      const out = await fetchWithSafeRedirects(target, {
        signal: controller.signal,
        headers: {
          // A desktop UA elicits richer OG tags from many sites.
          "user-agent":
            "Mozilla/5.0 (compatible; cHackerBlog-LinkPreview/1.0; +https://github.com/etcimon)",
          accept: "text/html,application/xhtml+xml",
        },
      });
      res = out.res;
      finalUrl = out.url;
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError("Failed to fetch the URL", 502, "FETCH_FAILED");
    }

    const contentType = res.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      // Not an HTML page (e.g. a direct file). Nothing to preview; return bare.
      return ok<LinkPreview>({ url: target.href });
    }

    // Read up to MAX_BYTES so we never buffer an enormous document.
    const reader = res.body?.getReader();
    let html = "";
    if (reader) {
      const decoder = new TextDecoder();
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        html += decoder.decode(value, { stream: true });
        if (received >= MAX_BYTES || /<\/head>/i.test(html)) {
          await reader.cancel().catch(() => {});
          break;
        }
      }
    } else {
      html = (await res.text()).slice(0, MAX_BYTES);
    }

    // Relative image URLs resolve against the final (post-redirect) URL, but
    // the reported url stays the one the caller asked for.
    return ok<LinkPreview>({ ...parseHtmlMeta(html, finalUrl.href), url: target.href });
  } finally {
    clearTimeout(timer);
  }
});
