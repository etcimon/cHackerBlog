/**
 * Pure helpers for the link-preview endpoint: the response shape, an SSRF
 * guard, and an Open Graph / Twitter Card / <title> metadata parser.
 *
 * Kept out of the route module because Next.js route files may only export
 * request handlers (GET/POST/…) plus a small set of config symbols; exporting
 * these helpers there breaks the generated route type. They also unit-test more
 * easily as a standalone module.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AppError } from "@/lib/errors";

export interface LinkPreview {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}

/** Reject private, loopback, link-local, and unique-local addresses. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map((n) => parseInt(n, 10));
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }
  if (v === 6) {
    const low = ip.toLowerCase();
    if (low === "::1" || low === "::") return true;
    if (low.startsWith("fe80")) return true; // link-local
    if (low.startsWith("fc") || low.startsWith("fd")) return true; // unique-local
    // IPv4-mapped (::ffff:a.b.c.d)
    const mapped = low.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return false;
  }
  return true; // unknown format -> treat as unsafe
}

/** Validate the URL and confirm its host resolves to a public address. */
export async function assertSafeUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new AppError("Invalid URL", 400, "INVALID_URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new AppError("Only http(s) URLs are supported", 400, "INVALID_SCHEME");
  }
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new AppError("Refused to fetch a private host", 400, "SSRF_BLOCKED");
  }
  // If the host is a literal IP, check it directly; otherwise resolve it.
  if (isIP(host)) {
    if (isPrivateAddress(host)) {
      throw new AppError("Refused to fetch a private address", 400, "SSRF_BLOCKED");
    }
    return u;
  }
  try {
    const results = await lookup(host, { all: true });
    if (results.some((r) => isPrivateAddress(r.address))) {
      throw new AppError("Refused to fetch a private address", 400, "SSRF_BLOCKED");
    }
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("Could not resolve host", 400, "DNS_ERROR");
  }
  return u;
}

/** Decode a handful of common HTML entities found in meta content. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, " ");
}

/** Read a `<meta>` content value for any of the given property/name keys. */
function metaContent(html: string, keys: string[]): string | undefined {
  for (const key of keys) {
    // Match <meta ... (property|name)="key" ... content="...">  (either order)
    const re = new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${key}["'][^>]*>`, "i");
    const tag = re.exec(html)?.[0];
    if (!tag) continue;
    const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (content) return decodeEntities(content.trim());
  }
  return undefined;
}

/** Extract preview metadata from an HTML document string. */
export function parseHtmlMeta(html: string, url: string): LinkPreview {
  const title =
    metaContent(html, ["og:title", "twitter:title"]) ??
    /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim();
  const description = metaContent(html, [
    "og:description",
    "twitter:description",
    "description",
  ]);
  let image = metaContent(html, [
    "og:image:secure_url",
    "og:image",
    "twitter:image",
    "twitter:image:src",
  ]);
  const siteName = metaContent(html, ["og:site_name"]);

  // Resolve a relative image URL against the page URL.
  if (image && !/^https?:\/\//i.test(image)) {
    try {
      image = new URL(image, url).href;
    } catch {
      image = undefined;
    }
  }

  return {
    url,
    title: title ? decodeEntities(title) : undefined,
    description,
    image,
    siteName,
  };
}
