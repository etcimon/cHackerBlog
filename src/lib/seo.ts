/**
 * Auto-derived SEO / social metadata for articles. Pure, deterministic string
 * processing — no DB, no network — so it is cheap to run on every create/update
 * and safe to memoize. There are deliberately NO custom-edit fields: keywords,
 * description and the share thumbnail are all computed from the article body.
 *
 * Determinism matters: the output is cached (feed/article categories) and baked
 * into per-article OG <meta>, so the same input must always yield the same
 * result. The "edge away from common words" requirement is implemented as a
 * frequency-prior penalty (an embedded stop/common-word list standing in for
 * "learning data", since there is no ML runtime here) combined with sublinear
 * term-frequency and a length bonus — NOT randomness, which would break caching.
 */

/** High-frequency English words demoted so keywords skew toward specific terms. */
const COMMON_WORDS = new Set<string>([
  "the", "and", "for", "are", "but", "not", "you", "all", "any", "can", "had",
  "her", "was", "one", "our", "out", "day", "get", "has", "him", "his", "how",
  "man", "new", "now", "old", "see", "two", "way", "who", "boy", "did", "its",
  "let", "put", "say", "she", "too", "use", "that", "this", "with", "from",
  "they", "will", "would", "there", "their", "what", "about", "which", "when",
  "make", "like", "time", "just", "know", "take", "into", "your", "some",
  "could", "them", "than", "then", "look", "only", "come", "over", "also",
  "back", "after", "use", "work", "first", "well", "even", "want", "because",
  "these", "give", "most", "very", "more", "such", "here", "where", "been",
  "have", "were", "does", "each", "other", "those", "while", "should", "being",
]);

/** Strip code, embeds and tags, returning readable prose for analysis. */
export function extractProse(html: string): string {
  if (!html) return "";
  return html
    // Drop highlighted/collapsible code regions entirely.
    .replace(/<pre[\s\S]*?<\/pre>/gi, " ")
    .replace(/<code[\s\S]*?<\/code>/gi, " ")
    // Drop attachment embeds (video/audio/file figures) and their captions.
    .replace(/<figure[^>]*data-embed[\s\S]*?<\/figure>/gi, " ")
    // Remaining tags -> spaces, then collapse whitespace and decode a few
    // common entities so word boundaries survive.
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Derive up to `max` SEO keywords. Each candidate token is scored by
 *   score = (1 + ln(freq)) * lengthFactor - commonnessPenalty
 * which rewards longer words that recur while demoting ubiquitous short words.
 * Ties break on score, then descending length, then alphabetically — fully
 * deterministic. Returns a comma-separated string (SQLite has no arrays).
 *
 * NOTE: tokenization is whitespace/Latin based; non-spaced scripts (CJK) are
 * not segmented and will yield few/no keywords by design rather than garbage.
 */
export function deriveKeywords(html: string, max = 8): string {
  const prose = extractProse(html).toLowerCase();
  const tokens = prose.match(/[a-z][a-z'-]{2,}/g) ?? [];
  if (tokens.length === 0) return "";

  const freq = new Map<string, number>();
  for (const raw of tokens) {
    const w = raw.replace(/^['-]+|['-]+$/g, "");
    if (w.length < 3) continue;
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }

  const scored: Array<{ word: string; score: number; len: number }> = [];
  for (const [word, count] of freq) {
    const lengthFactor = Math.min(word.length, 14) / 6; // saturates ~14 chars
    const commonnessPenalty = COMMON_WORDS.has(word) ? 2.5 : 0;
    const score = (1 + Math.log(count)) * lengthFactor - commonnessPenalty;
    if (score <= 0) continue;
    scored.push({ word, score, len: word.length });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.len - a.len ||
      a.word.localeCompare(b.word),
  );

  return scored.slice(0, max).map((s) => s.word).join(", ");
}

/** First reasonably long sentence of the prose, clamped to `maxChars`. */
export function deriveDescription(html: string, maxChars = 200): string {
  const prose = extractProse(html);
  if (!prose) return "";
  // Prefer a sentence boundary; fall back to a hard clamp on word boundary.
  const sentence = prose.match(/[^.!?]{40,}?[.!?](?:\s|$)/);
  const base = sentence ? sentence[0].trim() : prose;
  if (base.length <= maxChars) return base;
  const clipped = base.slice(0, maxChars);
  const lastSpace = clipped.lastIndexOf(" ");
  return (lastSpace > 40 ? clipped.slice(0, lastSpace) : clipped).trim() + "…";
}

/** Make a possibly-relative URL absolute against APP_URL. */
function absolutize(url: string, appUrl: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  return `${appUrl.replace(/\/$/, "")}/${url.replace(/^\//, "")}`;
}

/** A share image must be an absolute http(s) URL crawlers will fetch. */
function isShareableImage(url: string): boolean {
  if (!url) return false;
  if (url.startsWith("data:")) return false; // crawlers reject data URIs
  if (/\.svg(\?|#|$)/i.test(url)) return false; // most platforms reject SVG
  return true;
}

/**
 * Resolve the share thumbnail with the precedence:
 *   explicit article coverUrl -> first content <img src> -> site favicon ->
 *   the largest static app icon (apple-touch-icon, 180x180).
 * Always returns an absolute URL (or null only if appUrl is somehow empty).
 */
export function deriveThumbnail(opts: {
  html: string;
  coverUrl?: string | null;
  faviconUrl?: string | null;
  appUrl: string;
}): string | null {
  const { html, coverUrl, faviconUrl, appUrl } = opts;

  if (coverUrl && isShareableImage(coverUrl)) {
    return absolutize(coverUrl, appUrl);
  }

  const imgMatch = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgMatch?.[1] && isShareableImage(imgMatch[1])) {
    return absolutize(imgMatch[1], appUrl);
  }

  if (faviconUrl && isShareableImage(faviconUrl)) {
    return absolutize(faviconUrl, appUrl);
  }

  // Static fallback shipped in /public/favicon (see app/layout.tsx).
  return absolutize("/favicon/apple-touch-icon.png", appUrl);
}

export interface DerivedSeo {
  seoKeywords: string;
  seoDescription: string;
  thumbnailUrl: string | null;
}

/** Compute the full SEO bundle for an article in one call. */
export function deriveSeo(opts: {
  content: string;
  coverUrl?: string | null;
  faviconUrl?: string | null;
  appUrl: string;
}): DerivedSeo {
  return {
    seoKeywords: deriveKeywords(opts.content),
    seoDescription: deriveDescription(opts.content),
    thumbnailUrl: deriveThumbnail({
      html: opts.content,
      coverUrl: opts.coverUrl,
      faviconUrl: opts.faviconUrl,
      appUrl: opts.appUrl,
    }),
  };
}
