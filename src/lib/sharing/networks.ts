/**
 * Credential-free social sharing intent builders.
 *
 * This module is intentionally PURE and client-safe (no Node imports), sitting
 * beside the credentialed server poster in lib/social/*. Every network here is
 * reached via a public share/intent URL that relies on the user's own logged-in
 * session on that platform — no API keys, no OAuth, nothing server-side.
 *
 * Crucial behavioral note encoded below: Facebook and LinkedIn IGNORE any
 * caller-supplied text and scrape the destination's Open Graph tags instead, so
 * those builders pass only the URL. The article's image therefore flows through
 * the per-article <meta og:image> emitted by app/article/[slug], NOT through any
 * query parameter here.
 */

export type NetworkId =
  | "x"
  | "facebook"
  | "linkedin"
  | "reddit"
  | "whatsapp"
  | "telegram"
  | "email";

export interface SharePayload {
  /** Absolute, canonical article URL (the SEO slug path). */
  url: string;
  title: string;
  /** Auto-derived SEO description. */
  description?: string;
  /** Comma-separated seoKeywords; used as hashtags where supported. */
  keywords?: string;
  /** Optional "via" handle (settings.xHandle), without the leading @. */
  via?: string | null;
}

export interface ShareTarget {
  id: NetworkId;
  /** Human label for the button. */
  label: string;
  /** Ready-to-open share URL. */
  href: string;
  /** Brand color (used for icon/hover accents; theme owns the surface). */
  brand: string;
}

/** Turn "alpha, beta-gamma" into ["alpha","betagamma"] for hashtag params. */
export function toHashtags(keywords?: string): string[] {
  if (!keywords) return [];
  return keywords
    .split(",")
    .map((k) => k.trim().replace(/[^a-z0-9]/gi, ""))
    .filter(Boolean)
    .slice(0, 4);
}

/**
 * Build every supported share target for a payload. Order is roughly by general
 * popularity for article sharing.
 */
export function buildShareTargets(payload: SharePayload): ShareTarget[] {
  const url = payload.url;
  const title = payload.title;
  const desc = payload.description ?? "";
  const hashtags = toHashtags(payload.keywords);
  const e = encodeURIComponent;

  const xParams = new URLSearchParams({ url, text: title });
  if (hashtags.length) xParams.set("hashtags", hashtags.join(","));
  if (payload.via) xParams.set("via", payload.via.replace(/^@/, ""));

  return [
    {
      id: "x",
      label: "X",
      brand: "#000000",
      href: `https://x.com/intent/tweet?${xParams.toString()}`,
    },
    {
      id: "facebook",
      label: "Facebook",
      brand: "#1877F2",
      // Facebook reads OG tags from the destination; only the URL matters.
      href: `https://www.facebook.com/sharer/sharer.php?u=${e(url)}`,
    },
    {
      id: "linkedin",
      label: "LinkedIn",
      brand: "#0A66C2",
      // LinkedIn likewise scrapes OG from the destination URL.
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${e(url)}`,
    },
    {
      id: "reddit",
      label: "Reddit",
      brand: "#FF4500",
      href: `https://www.reddit.com/submit?url=${e(url)}&title=${e(title)}`,
    },
    {
      id: "whatsapp",
      label: "WhatsApp",
      brand: "#25D366",
      href: `https://api.whatsapp.com/send?text=${e(`${title} ${url}`)}`,
    },
    {
      id: "telegram",
      label: "Telegram",
      brand: "#26A5E4",
      href: `https://t.me/share/url?url=${e(url)}&text=${e(title)}`,
    },
    {
      id: "email",
      label: "Email",
      brand: "#6B7280",
      href: `mailto:?subject=${e(title)}&body=${e(`${desc ? desc + "\n\n" : ""}${url}`)}`,
    },
  ];
}

/** Payload shape for the Web Share API (navigator.share). */
export function toNativeShareData(payload: SharePayload): ShareData {
  return {
    title: payload.title,
    text: payload.description || payload.title,
    url: payload.url,
  };
}
