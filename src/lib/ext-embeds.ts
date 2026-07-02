/**
 * ext-embeds: platform-specific rich embed generation for external URLs.
 *
 * This library is the single source of truth for turning a recognized platform
 * URL (YouTube, Vimeo, Rumble, Twitch, X, Facebook, Instagram, SoundCloud,
 * YouTube Music) into the provider's canonical embed markup. It is deliberately
 * pure and dependency-free so it can run identically on the server (SSR article
 * render), in the browser (WYSIWYG marked rendering), and under jsdom (the
 * round-trip unit tests).
 *
 * Contract: given a raw URL, `buildProviderEmbed(url)` returns an `EmbedFrame`
 * describing the inner HTML to place inside a `.cb-embed__frame`, the visual
 * shape (video / audio / post) used for aspect-ratio styling, and an optional
 * external `script` the client hydrator must load (X / Instagram widgets). When
 * no provider matches — or a matched provider cannot yield a usable id — it
 * returns `null`, signalling the caller (`src/lib/embeds.ts`) to fall back to a
 * generic link-preview card instead.
 *
 * Round-trip safety: the embed markup is derived deterministically from the URL
 * alone; no fetched metadata is baked in. The canonical Markdown tag stores only
 * the URL (+ size + urlOnly), so `markdown -> HTML -> markdown` is stable.
 */

export type ProviderName =
  | "youtube"
  | "youtubemusic"
  | "vimeo"
  | "rumble"
  | "twitch"
  | "x"
  | "facebook"
  | "instagram"
  | "soundcloud";

/** Visual shape drives the aspect-ratio / height used by the frame container. */
export type EmbedShape = "video" | "audio" | "post";

export interface EmbedFrame {
  provider: ProviderName;
  /** Inner HTML to place inside `.cb-embed__frame`. */
  html: string;
  /** Aspect shape used for CSS sizing. */
  shape: EmbedShape;
  /** Human label for the provider (used in captions / a11y). */
  label: string;
  /** Optional external script URL the client hydrator must inject once. */
  script?: string;
}

/* ------------------------------- escaping -------------------------------- */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Parse a URL safely; returns null on malformed input. */
function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** Lowercased host with a leading `www.` stripped. */
function host(u: URL): string {
  return u.hostname.replace(/^www\./i, "").toLowerCase();
}

/**
 * The `parent` domain Twitch requires on every player iframe. Baked into the
 * stored HTML at author time (browser), falling back to localhost for SSR/tests.
 */
function twitchParent(): string {
  if (typeof window !== "undefined" && window.location?.hostname) {
    return window.location.hostname;
  }
  return "localhost";
}

/* ---------------------------- id extraction ------------------------------ */
/** YouTube (and YouTube Music) video id from any of its URL shapes. */
function youtubeId(u: URL): string | null {
  const h = host(u);
  if (h === "youtu.be") {
    const seg = u.pathname.split("/").filter(Boolean)[0];
    return seg || null;
  }
  const v = u.searchParams.get("v");
  if (v) return v;
  const parts = u.pathname.split("/").filter(Boolean);
  // /embed/ID, /shorts/ID, /live/ID, /v/ID
  const marker = parts.findIndex((p) => ["embed", "shorts", "live", "v"].includes(p));
  if (marker >= 0 && parts[marker + 1]) return parts[marker + 1]!;
  return null;
}

/** Vimeo numeric id from vimeo.com/ID or player.vimeo.com/video/ID. */
function vimeoId(u: URL): string | null {
  const m = u.pathname.match(/(?:\/video)?\/(\d+)/);
  return m ? m[1]! : null;
}

/** Rumble embed id (`vXXXXX`) from the article slug or an /embed/ID path. */
function rumbleId(u: URL): string | null {
  const parts = u.pathname.split("/").filter(Boolean);
  const embedIdx = parts.indexOf("embed");
  if (embedIdx >= 0 && parts[embedIdx + 1]) return parts[embedIdx + 1]!;
  // Article URLs look like /vABC123-some-title.html -> take the leading token.
  const slug = parts[parts.length - 1] || "";
  const m = slug.match(/^(v[a-z0-9]+)/i);
  return m ? m[1]! : null;
}

/** Instagram post/reel id from /p/ID/, /reel/ID/, /tv/ID/. */
function instagramId(u: URL): string | null {
  const m = u.pathname.match(/\/(?:p|reel|tv)\/([^/]+)/);
  return m ? m[1]! : null;
}

/* ---------------------------- frame builders ----------------------------- */
function iframe(src: string, extra = "", cls = "cb-embed__frame-el"): string {
  return (
    `<iframe class="${cls}" src="${esc(src)}" loading="lazy" ` +
    `frameborder="0" ${extra}></iframe>`
  );
}

function youtubeFrame(u: URL, music: boolean): EmbedFrame | null {
  const id = youtubeId(u);
  if (!id) return null;
  const src = `https://www.youtube.com/embed/${encodeURIComponent(id)}`;
  return {
    provider: music ? "youtubemusic" : "youtube",
    label: music ? "YouTube Music" : "YouTube",
    shape: "video",
    html: iframe(
      src,
      `title="YouTube video player" ` +
        `allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" ` +
        `referrerpolicy="strict-origin-when-cross-origin" allowfullscreen`,
    ),
  };
}

function vimeoFrame(u: URL): EmbedFrame | null {
  const id = vimeoId(u);
  if (!id) return null;
  return {
    provider: "vimeo",
    label: "Vimeo",
    shape: "video",
    html: iframe(
      `https://player.vimeo.com/video/${encodeURIComponent(id)}`,
      `title="Vimeo video player" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen`,
    ),
  };
}

function rumbleFrame(u: URL): EmbedFrame | null {
  const id = rumbleId(u);
  if (!id) return null;
  return {
    provider: "rumble",
    label: "Rumble",
    shape: "video",
    html: iframe(
      `https://rumble.com/embed/${encodeURIComponent(id)}/`,
      `title="Rumble video player" allowfullscreen`,
    ),
  };
}

function twitchFrame(u: URL): EmbedFrame | null {
  const parent = twitchParent();
  const parts = u.pathname.split("/").filter(Boolean);
  const h = host(u);
  let src: string | null = null;

  if (h === "clips.twitch.tv" && parts[0]) {
    src = `https://clips.twitch.tv/embed?clip=${encodeURIComponent(parts[0])}&parent=${encodeURIComponent(parent)}`;
  } else if (parts[0] === "videos" && parts[1]) {
    src = `https://player.twitch.tv/?video=${encodeURIComponent(parts[1])}&parent=${encodeURIComponent(parent)}`;
  } else if (parts[1] === "clip" && parts[2]) {
    src = `https://clips.twitch.tv/embed?clip=${encodeURIComponent(parts[2])}&parent=${encodeURIComponent(parent)}`;
  } else if (parts[0]) {
    src = `https://player.twitch.tv/?channel=${encodeURIComponent(parts[0])}&parent=${encodeURIComponent(parent)}`;
  }
  if (!src) return null;
  return {
    provider: "twitch",
    label: "Twitch",
    shape: "video",
    html: iframe(src, `title="Twitch player" allowfullscreen`),
  };
}

function soundcloudFrame(u: URL): EmbedFrame {
  // The SoundCloud widget resolves a track by its permalink; strip tracking
  // params for the player src while the canonical Markdown keeps the original.
  const clean = `${u.origin}${u.pathname}`;
  const params =
    `url=${encodeURIComponent(clean)}` +
    `&color=%23ff5500&auto_play=false&hide_related=false` +
    `&show_comments=true&show_user=true&show_reposts=false&show_teaser=true`;
  return {
    provider: "soundcloud",
    label: "SoundCloud",
    shape: "audio",
    html: iframe(
      `https://w.soundcloud.com/player/?${params}`,
      `title="SoundCloud player" allow="autoplay" scrolling="no"`,
    ),
  };
}

function instagramFrame(u: URL): EmbedFrame | null {
  const id = instagramId(u);
  if (!id) return null;
  const kind = u.pathname.includes("/reel/") ? "reel" : "p";
  return {
    provider: "instagram",
    label: "Instagram",
    shape: "post",
    html: iframe(
      `https://www.instagram.com/${kind}/${encodeURIComponent(id)}/embed`,
      `title="Instagram post" scrolling="no" allowtransparency="true"`,
    ),
  };
}

function facebookFrame(u: URL): EmbedFrame {
  const isVideo = /\/videos?\//.test(u.pathname) || u.pathname.includes("watch");
  const base = isVideo
    ? "https://www.facebook.com/plugins/video.php"
    : "https://www.facebook.com/plugins/post.php";
  const src = `${base}?href=${encodeURIComponent(u.href)}&show_text=true`;
  return {
    provider: "facebook",
    label: "Facebook",
    shape: "post",
    html: iframe(src, `title="Facebook post" scrolling="no" allowtransparency="true" allowfullscreen`),
  };
}

function xFrame(u: URL): EmbedFrame {
  // X/Twitter uses widgets.js to upgrade a blockquote into a rendered tweet.
  return {
    provider: "x",
    label: "X",
    shape: "post",
    script: "https://platform.twitter.com/widgets.js",
    html:
      `<blockquote class="twitter-tweet" data-dnt="true">` +
      `<a href="${esc(u.href)}"></a></blockquote>`,
  };
}

/* ------------------------------- dispatch -------------------------------- */
/**
 * Detect which provider (if any) a URL belongs to, without building markup.
 * Useful for lightweight checks (e.g. deciding whether an external URL will
 * render as a rich embed vs. a generic preview).
 */
export function detectProvider(url: string): ProviderName | null {
  const u = parse(url);
  if (!u) return null;
  const h = host(u);
  if (h === "music.youtube.com") return "youtubemusic";
  if (h === "youtube.com" || h === "m.youtube.com" || h === "youtu.be") return "youtube";
  if (h === "vimeo.com" || h === "player.vimeo.com") return "vimeo";
  if (h === "rumble.com") return "rumble";
  if (h === "twitch.tv" || h === "clips.twitch.tv" || h === "player.twitch.tv") return "twitch";
  if (h === "x.com" || h === "twitter.com") return "x";
  if (h === "facebook.com" || h === "fb.watch") return "facebook";
  if (h === "instagram.com") return "instagram";
  if (h === "soundcloud.com") return "soundcloud";
  return null;
}

/**
 * Build the provider-specific embed frame for a URL, or null when no provider
 * matches or a matched provider cannot produce a usable id (caller then renders
 * the generic link-preview fallback).
 */
export function buildProviderEmbed(url: string): EmbedFrame | null {
  const u = parse(url);
  if (!u) return null;
  const provider = detectProvider(url);
  switch (provider) {
    case "youtube":
      return youtubeFrame(u, false);
    case "youtubemusic":
      return youtubeFrame(u, true);
    case "vimeo":
      return vimeoFrame(u);
    case "rumble":
      return rumbleFrame(u);
    case "twitch":
      return twitchFrame(u);
    case "soundcloud":
      return soundcloudFrame(u);
    case "instagram":
      return instagramFrame(u);
    case "facebook":
      return facebookFrame(u);
    case "x":
      return xFrame(u);
    default:
      return null;
  }
}
