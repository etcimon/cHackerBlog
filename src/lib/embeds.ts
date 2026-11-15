/**
 * Attachment embeds: inline file/video/audio blocks for the WYSIWYG editor and
 * the rendered article body.
 *
 * Storage format is HTML (the article body is HTML). To survive the editor's
 * HTML <-> Markdown round-trip (turndown / marked) and to work with remotely
 * hosted files, every embed is also representable by a single custom Markdown
 * tag:
 *
 *     @[filename.ext](https://host/path/file.ext)
 *
 * Size can be specified after the filename:
 *
 *     @[filename.ext 640x360](url)           // explicit width x height in pixels
 *     @[filename.ext 50%](url)              // percentage width
 *     @[filename.ext small](url)            // preset size (small/medium/large)
 *     @[filename.ext width=640](url)       // named width parameter
 *     @[filename.ext width=640 height=360](url)  // named width and height
 *
 * The rendered HTML carries `data-embed="1"`, `data-name`, `data-src`, and
 * `data-size` so the turndown rule can collapse it back to the `@[...]( ...)` tag
 * losslessly, and the marked extension can expand the tag back into the same HTML.
 *
 * No new runtime dependencies: native <video>/<audio> players and inline SVG
 * icons (lucide path data) keep the footprint small and the look native.
 *
 * External URL embeds build on the exact same `@[...]( ...)` grammar. When the
 * href is an external http(s) page (not a local upload and not a remote file
 * with a known media extension) the tag is treated as a *URL embed*: recognized
 * platforms (YouTube, Vimeo, Rumble, Twitch, X, Facebook, Instagram,
 * SoundCloud, YouTube Music) render a rich provider embed via `ext-embeds`,
 * everything else renders a generic link-preview card with a "Visit site"
 * button hydrated by `/api/link-preview`. The bracket carries only the optional
 * size spec and an optional `urlOnly` keyword (which suppresses the preview and
 * renders a plain link), keeping the round-trip lossless:
 *
 *     @[](https://youtu.be/ID)                 // rich embed, default preview
 *     @[640x360](https://youtu.be/ID)          // sized rich embed
 *     @[urlOnly](https://example.com/post)     // plain link, no preview
 */
import { buildProviderEmbed } from "@/lib/ext-embeds";

export type EmbedKind = "video" | "audio" | "file";
export type FileCategory =
  | "video"
  | "audio"
  | "document"
  | "spreadsheet"
  | "slides"
  | "archive"
  | "generic";

/** Size specification for embeds. */
export type EmbedSize =
  | { type: "pixels"; width: number; height: number }
  | { type: "percent"; width: number }
  | { type: "preset"; size: "small" | "medium" | "large" }
  | { type: "none" };

/**
 * State machine parser for size specifications in markdown embed tags.
 * Parses formats like:
 * - "640x360" -> { type: "pixels", width: 640, height: 360 }
 * - "50%" -> { type: "percent", width: 50 }
 * - "small" -> { type: "preset", size: "small" }
 * - "width=640" -> { type: "pixels", width: 640, height: 0 }
 * - "width=640 height=360" -> { type: "pixels", width: 640, height: 360 }
 */
export function parseSizeSpec(input: string): EmbedSize {
  const trimmed = input.trim();
  if (!trimmed) return { type: "none" };

  // State machine states
  type State =
    | "start"
    | "digit"
    | "after_digit"
    | "x"
    | "after_x"
    | "percent"
    | "preset"
    | "named_key"
    | "named_equals"
    | "named_value"
    | "named_after_value"
    | "space";

  let state: State = "start";
  let width = 0;
  let height = 0;
  let currentNumber = "";
  let currentKey = "";
  let presetName = "";

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];

    switch (state) {
      case "start":
        if (char >= "0" && char <= "9") {
          state = "digit";
          currentNumber = char;
        } else if (char === "s" || char === "S") {
          state = "preset";
          presetName = char.toLowerCase();
        } else if (char === "m" || char === "M") {
          state = "preset";
          presetName = char.toLowerCase();
        } else if (char === "l" || char === "L") {
          state = "preset";
          presetName = char.toLowerCase();
        } else if (char === "w" || char === "W") {
          state = "named_key";
          currentKey = char.toLowerCase();
        } else if (char === " ") {
          state = "space";
        } else {
          return { type: "none" };
        }
        break;

      case "digit":
        if (char >= "0" && char <= "9") {
          currentNumber += char;
        } else if (char === "x" || char === "X") {
          width = parseInt(currentNumber, 10);
          state = "x";
          currentNumber = "";
        } else if (char === "%") {
          width = parseInt(currentNumber, 10);
          return { type: "percent", width };
        } else if (char === " ") {
          width = parseInt(currentNumber, 10);
          state = "after_digit";
          currentNumber = "";
        } else {
          return { type: "none" };
        }
        break;

      case "after_digit":
        if (char === "x" || char === "X") {
          state = "x";
        } else if (char === " ") {
          // continue
        } else {
          return { type: "none" };
        }
        break;

      case "x":
        if (char >= "0" && char <= "9") {
          state = "after_x";
          currentNumber = char;
        } else if (char === " ") {
          // continue
        } else {
          return { type: "none" };
        }
        break;

      case "after_x":
        if (char >= "0" && char <= "9") {
          currentNumber += char;
        } else if (char === " " || i === trimmed.length - 1) {
          height = parseInt(currentNumber, 10);
          state = "space";
        } else {
          return { type: "none" };
        }
        break;


      case "preset":
        if (char >= "a" && char <= "z") {
          presetName += char;
        } else if (char === " " || i === trimmed.length - 1) {
          if (presetName === "small" || presetName === "medium" || presetName === "large") {
            return { type: "preset", size: presetName as "small" | "medium" | "large" };
          }
          return { type: "none" };
        } else {
          return { type: "none" };
        }
        break;

      case "named_key":
        if (char >= "a" && char <= "z") {
          currentKey += char;
        } else if (char === "=") {
          state = "named_equals";
        } else {
          return { type: "none" };
        }
        break;

      case "named_equals":
        if (char >= "0" && char <= "9") {
          state = "named_value";
          currentNumber = char;
        } else {
          return { type: "none" };
        }
        break;

      case "named_value":
        if (char >= "0" && char <= "9") {
          currentNumber += char;
        } else if (char === " " || i === trimmed.length - 1) {
          const value = parseInt(currentNumber, 10);
          if (currentKey === "width") {
            width = value;
          } else if (currentKey === "height") {
            height = value;
          }
          currentKey = "";
          currentNumber = "";
          state = "named_after_value";
        } else {
          return { type: "none" };
        }
        break;

      case "named_after_value":
        if (char === " ") {
          // continue
        } else if (char >= "a" && char <= "z") {
          state = "named_key";
          currentKey = char.toLowerCase();
        } else {
          return { type: "none" };
        }
        break;

      case "space":
        if (char === " ") {
          // continue
        } else if (char >= "0" && char <= "9") {
          state = "digit";
          currentNumber = char;
        } else if (char === "s" || char === "S" || char === "m" || char === "M" || char === "l" || char === "L") {
          state = "preset";
          presetName = char.toLowerCase();
        } else if (char === "w" || char === "W") {
          state = "named_key";
          currentKey = char.toLowerCase();
        } else {
          return { type: "none" };
        }
        break;
    }
  }

  // Handle end of string
  if (state === "digit") {
    width = parseInt(currentNumber, 10);
    return { type: "pixels", width, height: 0 };
  }
  if (state === "after_x") {
    height = parseInt(currentNumber, 10);
    return { type: "pixels", width, height };
  }
  if (state === "preset") {
    if (presetName === "small" || presetName === "medium" || presetName === "large") {
      return { type: "preset", size: presetName as "small" | "medium" | "large" };
    }
    return { type: "none" };
  }
  if (state === "named_value") {
    const value = parseInt(currentNumber, 10);
    if (currentKey === "width") {
      width = value;
    } else if (currentKey === "height") {
      height = value;
    }
    return { type: "pixels", width, height };
  }

  return { type: "none" };
}

/**
 * Convert an EmbedSize back to its markdown string representation.
 */
export function sizeSpecToString(size: EmbedSize): string {
  switch (size.type) {
    case "pixels":
      if (size.height > 0) {
        return `${size.width}x${size.height}`;
      }
      return `width=${size.width}`;
    case "percent":
      return `${size.width}%`;
    case "preset":
      return size.size;
    case "none":
      return "";
  }
}

/** Extension -> rendering kind. Anything not listed renders as a file card. */
const VIDEO_EXTS = ["mp4", "webm", "mov", "avi", "mkv", "ogv", "m4v"];
const AUDIO_EXTS = ["mp3", "wav", "ogg", "m4a", "flac", "aac", "opus"];
const DOCUMENT_EXTS = ["pdf", "doc", "docx", "odt", "rtf", "txt", "md"];
const SPREADSHEET_EXTS = ["xls", "xlsx", "csv", "ods"];
const SLIDES_EXTS = ["ppt", "pptx", "odp"];
const ARCHIVE_EXTS = ["zip", "rar", "7z", "tar", "gz"];

/** All extensions accepted by the file upload button. */
export const ALLOWED_FILE_EXTS: string[] = [
  ...VIDEO_EXTS,
  ...AUDIO_EXTS,
  ...DOCUMENT_EXTS,
  ...SPREADSHEET_EXTS,
  ...SLIDES_EXTS,
  ...ARCHIVE_EXTS,
];

/** Comma-separated `accept` attribute value for the file <input>. */
export const FILE_ACCEPT = ALLOWED_FILE_EXTS.map((e) => `.${e}`).join(",");

/** MIME type per extension (used by the upload + file-serving routes). */
export const CONTENT_TYPES: Record<string, string> = {
  // images
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  // video
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
  ogv: "video/ogg",
  m4v: "video/x-m4v",
  // audio
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  flac: "audio/flac",
  aac: "audio/aac",
  opus: "audio/opus",
  // documents
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  odt: "application/vnd.oasis.opendocument.text",
  rtf: "application/rtf",
  txt: "text/plain",
  md: "text/markdown",
  // spreadsheets
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  // slides
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odp: "application/vnd.oasis.opendocument.presentation",
  // archives
  zip: "application/zip",
  rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed",
  tar: "application/x-tar",
  gz: "application/gzip",
};

/** Extract a lowercased file extension from a name or URL (no leading dot). */
export function extOf(nameOrUrl: string): string {
  const clean = nameOrUrl.split(/[?#]/)[0] ?? "";
  const dot = clean.lastIndexOf(".");
  if (dot === -1 || dot === clean.length - 1) return "";
  return clean.slice(dot + 1).toLowerCase();
}

export function kindForExt(ext: string): EmbedKind {
  if (VIDEO_EXTS.includes(ext)) return "video";
  if (AUDIO_EXTS.includes(ext)) return "audio";
  return "file";
}

export function categoryForExt(ext: string): FileCategory {
  if (VIDEO_EXTS.includes(ext)) return "video";
  if (AUDIO_EXTS.includes(ext)) return "audio";
  if (DOCUMENT_EXTS.includes(ext)) return "document";
  if (SPREADSHEET_EXTS.includes(ext)) return "spreadsheet";
  if (SLIDES_EXTS.includes(ext)) return "slides";
  if (ARCHIVE_EXTS.includes(ext)) return "archive";
  return "generic";
}

/* ---------------------------- url detection ------------------------------ */
const IMAGE_EXTS = ["jpg", "jpeg", "png", "gif", "svg", "webp", "avif", "bmp", "ico"];

/** Extensions that identify a *file* (media/doc) rather than an HTML page. */
const FILE_LIKE_EXTS = new Set<string>([...ALLOWED_FILE_EXTS, ...IMAGE_EXTS]);

/** True for an absolute http(s) URL. */
export function isExternalHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

/**
 * Decide whether an `@[...]( href)` tag should render as a *URL embed* (rich
 * provider embed or generic link preview) rather than a file/media embed.
 *
 * A URL embed is any external http(s) href that is neither a local upload
 * (`/api/uploads/...`) nor a direct link to a file with a known media/document
 * extension (those keep rendering as native <video>/<audio>/file cards).
 */
export function shouldTreatAsUrlEmbed(href: string): boolean {
  if (!isExternalHttpUrl(href)) return false;
  if (href.includes("/api/uploads/")) return false;
  const ext = extOf(href);
  if (ext && FILE_LIKE_EXTS.has(ext)) return false;
  return true;
}

/* --------------------------------- icons --------------------------------- */
// Inline lucide path data (stroke uses currentColor). 24x24 viewBox.
const ICON_PATHS: Record<FileCategory, string> = {
  document:
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  spreadsheet:
    '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>',
  slides:
    '<path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/>',
  archive:
    '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  video:
    '<path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2"/>',
  audio: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  generic:
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
};

const DOWNLOAD_ICON =
  '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>';

function svg(paths: string): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" ' +
    'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' +
    paths +
    "</svg>"
  );
}

/* ------------------------------- escaping -------------------------------- */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

/* ----------------------------- HTML builder ------------------------------ */
export interface EmbedInput {
  /** Display name / title (usually the original filename). */
  name: string;
  /** File URL (local `/api/uploads/...` or any remote URL). */
  src: string;
  /** Optional size specification. */
  size?: EmbedSize;
}

/**
 * Build the stored/rendered HTML for an attachment. The output is self-styling
 * via `.cb-embed*` classes (see globals.scss) and carries data attributes so it
 * round-trips losslessly through turndown/marked.
 */
export function buildEmbedHtml({ name, src, size }: EmbedInput): string {
  const ext = extOf(name) || extOf(src);
  const kind = kindForExt(ext);
  const safeName = escapeHtml(name || src);
  const aName = escapeAttr(name || src);
  const aSrc = escapeAttr(src);
  const sizeSpec = size ? sizeSpecToString(size) : "";
  const dataAttrs = `data-embed="1" data-name="${aName}" data-src="${aSrc}" data-size="${escapeAttr(
    sizeSpec,
  )}"`;

  // Build size class and inline styles
  let sizeClass = "";
  let sizeStyle = "";
  if (size) {
    switch (size.type) {
      case "pixels":
        sizeClass = "cb-embed--size-pixels";
        sizeStyle = `width: ${size.width}px;`;
        if (size.height > 0) {
          sizeStyle += ` height: ${size.height}px;`;
        }
        break;
      case "percent":
        sizeClass = "cb-embed--size-percent";
        sizeStyle = `width: ${size.width}%;`;
        break;
      case "preset":
        sizeClass = `cb-embed--size-${size.size}`;
        break;
      case "none":
        break;
    }
  }

  const baseClass = `cb-embed cb-embed--${kind} ${sizeClass}`.trim();

  if (kind === "video") {
    const mediaStyle = sizeStyle ? ` style="${sizeStyle}"` : "";
    return (
      `<figure class="${baseClass}" contenteditable="false" ${dataAttrs}>` +
      `<video class="cb-embed__media" controls preload="metadata" src="${aSrc}"${mediaStyle}>` +
      `<a href="${aSrc}">${safeName}</a></video>` +
      `<figcaption class="cb-embed__caption">${safeName}</figcaption>` +
      `</figure>`
    );
  }

  if (kind === "audio") {
    const mediaStyle = sizeStyle ? ` style="${sizeStyle}"` : "";
    return (
      `<figure class="${baseClass}" contenteditable="false" ${dataAttrs}>` +
      `<figcaption class="cb-embed__caption">${safeName}</figcaption>` +
      `<audio class="cb-embed__media" controls preload="metadata" src="${aSrc}"${mediaStyle}>` +
      `<a href="${aSrc}">${safeName}</a></audio>` +
      `</figure>`
    );
  }

  const category = categoryForExt(ext);
  const typeLabel = ext ? ext.toUpperCase() : "FILE";
  const containerStyle = sizeStyle ? ` style="${sizeStyle}"` : "";
  return (
    `<div class="${baseClass}" contenteditable="false" ${dataAttrs} data-ext="${escapeAttr(
      ext,
    )}"${containerStyle}>` +
    `<span class="cb-embed__icon">${svg(ICON_PATHS[category])}</span>` +
    `<span class="cb-embed__meta">` +
    `<span class="cb-embed__name">${safeName}</span>` +
    `<span class="cb-embed__type">${typeLabel}</span>` +
    `</span>` +
    `<a class="cb-embed__btn" href="${aSrc}" download title="Download ${aName}">` +
    `${svg(DOWNLOAD_ICON)}<span>Download</span></a>` +
    `</div>`
  );
}

/* --------------------------- markdown tag form --------------------------- */
/** `@[name](url)` — the canonical Markdown representation of an embed. */
export function buildEmbedMarkdown({ name, src, size }: EmbedInput): string {
  const sizeSpec = size ? sizeSpecToString(size) : "";
  if (sizeSpec) {
    return `@[${name} ${sizeSpec}](${src})`;
  }
  return `@[${name}](${src})`;
}

/* ----------------------------- url embeds -------------------------------- */
/** Prefetched Open Graph metadata used to hydrate a generic preview card. */
export interface LinkMeta {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}

export interface UrlEmbedInput {
  /** The external page URL. */
  url: string;
  /** Optional size specification (applies to rich embeds + preview cards). */
  size?: EmbedSize;
  /** When true, render only a plain link (no rich embed, no preview card). */
  urlOnly?: boolean;
  /** Optional prefetched metadata to bake into the generic preview card. */
  meta?: LinkMeta;
}

/** Parse the bracket of a URL embed into its size spec + `urlOnly` flag. */
export function parseUrlBracket(bracket: string): { size: EmbedSize; urlOnly: boolean } {
  const tokens = bracket.trim().split(/\s+/).filter(Boolean);
  let urlOnly = false;
  const rest: string[] = [];
  for (const t of tokens) {
    if (t.toLowerCase() === "urlonly") urlOnly = true;
    else rest.push(t);
  }
  const sizeSpec = rest.join(" ").trim();
  const size = sizeSpec ? parseSizeSpec(sizeSpec) : { type: "none" as const };
  return { size, urlOnly };
}

/**
 * `@[size? urlOnly?](url)` — the canonical Markdown for a URL embed. Only the
 * URL, the optional size, and the optional `urlOnly` keyword are stored; the
 * bracket is empty for a bare rich embed (`@[](url)`), keeping the round-trip
 * deterministic (metadata is re-derived / re-fetched, never serialized).
 */
export function buildUrlEmbedMarkdown({ url, size, urlOnly }: UrlEmbedInput): string {
  const tokens: string[] = [];
  const sizeSpec = size ? sizeSpecToString(size) : "";
  if (sizeSpec) tokens.push(sizeSpec);
  if (urlOnly) tokens.push("urlOnly");
  return `@[${tokens.join(" ")}](${url})`;
}

/** Hostname (sans leading www.) for a URL, or the raw string on parse failure. */
function urlHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

/**
 * Map a size spec to the inline style applied to a URL-embed figure. Rich
 * embeds fill this width and derive height from the shape's aspect ratio;
 * explicit pixel height (WxH) forces a fixed frame height.
 */
function urlEmbedSize(size?: EmbedSize): { cls: string; figureStyle: string; frameStyle: string } {
  if (!size || size.type === "none") return { cls: "", figureStyle: "", frameStyle: "" };
  switch (size.type) {
    case "pixels": {
      const figureStyle = `width: ${size.width}px;`;
      const frameStyle = size.height > 0 ? `height: ${size.height}px;` : "";
      return { cls: "cb-embed--size-pixels", figureStyle, frameStyle };
    }
    case "percent":
      return { cls: "cb-embed--size-percent", figureStyle: `width: ${size.width}%;`, frameStyle: "" };
    case "preset":
      return { cls: `cb-embed--size-${size.size}`, figureStyle: "", frameStyle: "" };
    default:
      return { cls: "", figureStyle: "", frameStyle: "" };
  }
}

// Lucide "external-link" glyph for the Visit-site button.
const EXTERNAL_LINK_ICON =
  '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>';

/** Common data attributes so a URL embed round-trips via the turndown rule. */
function urlDataAttrs(url: string, size?: EmbedSize, urlOnly?: boolean): string {
  const sizeSpec = size ? sizeSpecToString(size) : "";
  return (
    `data-embed="1" data-embed-type="url" data-src="${escapeAttr(url)}" ` +
    `data-size="${escapeAttr(sizeSpec)}"${urlOnly ? ' data-url-only="1"' : ""}`
  );
}

/**
 * Build the stored/rendered HTML for a URL embed. Three branches:
 *  - `urlOnly` -> a plain anchor (no preview),
 *  - recognized provider -> a rich `.cb-embed__frame` (iframe / blockquote),
 *  - otherwise -> a generic link-preview card (thumbnail, title, host, Visit
 *    site) marked `data-link-hydrate="1"` for client-side metadata enrichment.
 *
 * All three carry the same `data-embed`/`data-embed-type`/`data-src`/`data-size`
 * attributes, so a single turndown rule collapses any of them back to the tag.
 */
export function buildUrlEmbedHtml({ url, size, urlOnly, meta }: UrlEmbedInput): string {
  const aUrl = escapeAttr(url);
  const data = urlDataAttrs(url, size, urlOnly);
  const { cls: sizeCls, figureStyle, frameStyle } = urlEmbedSize(size);

  // Plain-link branch: no preview at all.
  if (urlOnly) {
    return (
      `<a class="cb-embed cb-embed--urlonly" contenteditable="false" ${data} ` +
      `href="${aUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`
    );
  }

  // Rich provider branch.
  const frame = buildProviderEmbed(url);
  if (frame) {
    const figClass = `cb-embed cb-embed--url cb-embed--rich cb-embed--${frame.provider} ${sizeCls}`.trim();
    const figStyle = figureStyle ? ` style="${figureStyle}"` : "";
    const frStyle = frameStyle ? ` style="${frameStyle}"` : "";
    const scriptAttr = frame.script ? ` data-embed-script="${escapeAttr(frame.script)}"` : "";
    return (
      `<figure class="${figClass}" contenteditable="false" ${data} ` +
      `data-provider="${escapeAttr(frame.provider)}" data-shape="${frame.shape}"${scriptAttr}${figStyle}>` +
      `<div class="cb-embed__frame cb-embed__frame--${frame.shape}"${frStyle}>${frame.html}</div>` +
      `<figcaption class="cb-embed__caption">` +
      `<a href="${aUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(frame.label)} — ${escapeHtml(urlHost(url))}</a>` +
      `</figcaption>` +
      `</figure>`
    );
  }

  // Generic link-preview branch (fallback with a Visit-site button).
  const host = urlHost(url);
  const title = meta?.title ? escapeHtml(meta.title) : escapeHtml(host);
  const desc = meta?.description ? escapeHtml(meta.description) : "";
  const img = meta?.image ? escapeAttr(meta.image) : "";
  const site = meta?.siteName ? escapeHtml(meta.siteName) : escapeHtml(host);
  const figClass = `cb-embed cb-embed--url cb-embed--link ${sizeCls}`.trim();
  const figStyle = figureStyle ? ` style="${figureStyle}"` : "";
  const thumb = img
    ? `<img class="cb-embed__thumb" src="${img}" alt="" loading="lazy" />`
    : `<span class="cb-embed__thumb cb-embed__thumb--empty" aria-hidden="true">${svg(ICON_PATHS.generic)}</span>`;

  return (
    `<figure class="${figClass}" contenteditable="false" ${data} data-link-hydrate="1"${figStyle}>` +
    `<a class="cb-embed__link" href="${aUrl}" target="_blank" rel="noopener noreferrer">` +
    thumb +
    `<span class="cb-embed__meta">` +
    `<span class="cb-embed__site">${site}</span>` +
    `<span class="cb-embed__title">${title}</span>` +
    (desc ? `<span class="cb-embed__desc">${desc}</span>` : "") +
    `<span class="cb-embed__url">${escapeHtml(host)}</span>` +
    `</span>` +
    `</a>` +
    `<a class="cb-embed__btn cb-embed__visit" href="${aUrl}" target="_blank" rel="noopener noreferrer" title="Visit ${escapeAttr(host)}">` +
    `${svg(EXTERNAL_LINK_ICON)}<span>Visit site</span></a>` +
    `</figure>`
  );
}

/* ---------------------------- sized images ------------------------------ */
/**
 * Input for a sized inline image. Mirrors `EmbedInput` but for the standard
 * Markdown image syntax with a trailing size spec:
 *
 *     ![alt](url){small}
 *     ![alt](url){width=250 height=300}
 *     ![alt](url){50%}
 *     ![alt](url){640x360}
 *
 * The size spec reuses the same grammar as embeds via `parseSizeSpec` /
 * `sizeSpecToString`, so both features stay in lockstep.
 */
export interface ImageInput {
  /** Alt text. */
  alt: string;
  /** Image URL. */
  src: string;
  /** Optional size specification. */
  size?: EmbedSize;
}

/**
 * Build the stored/rendered HTML for a sized image. Carries `data-cb-img="1"`
 * plus `data-alt`, `data-src`, `data-size` so the turndown rule can collapse it
 * back to `![alt](url){spec}` losslessly.
 */
export function buildImageHtml({ alt, src, size }: ImageInput): string {
  const aAlt = escapeAttr(alt);
  const aSrc = escapeAttr(src);
  const sizeSpec = size ? sizeSpecToString(size) : "";

  let sizeClass = "";
  let sizeStyle = "";
  if (size) {
    switch (size.type) {
      case "pixels":
        sizeClass = "cb-img--size-pixels";
        sizeStyle = `width: ${size.width}px;`;
        if (size.height > 0) {
          sizeStyle += ` height: ${size.height}px;`;
        }
        break;
      case "percent":
        sizeClass = "cb-img--size-percent";
        sizeStyle = `width: ${size.width}%;`;
        break;
      case "preset":
        sizeClass = `cb-img--size-${size.size}`;
        break;
      case "none":
        break;
    }
  }

  const cls = `cb-img ${sizeClass}`.trim();
  const styleAttr = sizeStyle ? ` style="${sizeStyle}"` : "";
  // Base64 data: URLs already live in `src`; duplicating them into data-src
  // would double a multi-MB payload in the stored HTML.
  const dataSrcAttr = /^data:/i.test(src) ? "" : ` data-src="${aSrc}"`;
  return (
    `<img class="${cls}" src="${aSrc}" alt="${aAlt}" ` +
    `data-cb-img="1" data-alt="${aAlt}"${dataSrcAttr} ` +
    `data-size="${escapeAttr(sizeSpec)}"${styleAttr} />`
  );
}

/** `![alt](url){spec}` — the canonical Markdown representation of a sized image. */
export function buildImageMarkdown({ alt, src, size }: ImageInput): string {
  const sizeSpec = size ? sizeSpecToString(size) : "";
  if (sizeSpec) {
    return `![${alt}](${src}){${sizeSpec}}`;
  }
  return `![${alt}](${src})`;
}

/**
 * Matches a Markdown image immediately followed by a `{size}` spec at the start
 * of the input: `![alt](url){spec}`.
 */
const SIZED_IMAGE_RULE = /^!\[([^\]]*)\]\(\s*([^)\s]+)\s*\)\{([^}]+)\}/;

/**
 * Register the `![alt](url){spec}` inline tokenizer + renderer on a marked
 * instance. Idempotent per-instance via a private flag. Images without a valid
 * `{spec}` fall through to marked's default image handling.
 */
export function registerImageSizeExtension(marked: {
  use: (...args: import("marked").MarkedExtension[]) => typeof marked;
}): void {
  const flagged = marked as unknown as { __cbImgSize?: boolean };
  if (flagged.__cbImgSize) return;
  flagged.__cbImgSize = true;

  marked.use({
    extensions: [
      {
        name: "sizedImage",
        level: "inline",
        start(src: string) {
          const i = src.indexOf("![");
          return i < 0 ? undefined : i;
        },
        tokenizer(src: string) {
          const m = SIZED_IMAGE_RULE.exec(src);
          if (!m) return undefined;
          const alt = m[1] ?? "";
          const href = m[2] ?? "";
          const spec = (m[3] ?? "").trim();
          const size = parseSizeSpec(spec);
          // Unknown spec -> let the default image tokenizer handle it (the
          // literal `{spec}` will remain as trailing text).
          if (size.type === "none") return undefined;
          return {
            type: "sizedImage",
            raw: m[0],
            alt,
            href,
            size,
          };
        },
        renderer(token: import("marked").Tokens.Generic) {
          const t = token as unknown as { alt: string; href: string; size?: EmbedSize };
          return buildImageHtml({ alt: t.alt, src: t.href, size: t.size });
        },
      },
    ],
  });
}

/**
 * Add a turndown rule that collapses sized-image HTML back into the
 * `![alt](url){spec}` tag. Only applies to `<img data-cb-img="1">`; plain
 * images fall through to turndown's default image handling.
 */
export function addImageTurndownRule(turndown: {
  addRule: (key: string, rule: unknown) => void;
}): void {
  turndown.addRule("cbImg", {
    filter: (node: HTMLElement) =>
      node.nodeType === 1 &&
      node.nodeName === "IMG" &&
      typeof node.getAttribute === "function" &&
      node.getAttribute("data-cb-img") === "1",
    replacement: (_content: string, node: HTMLElement) => {
      const alt = node.getAttribute("data-alt") ?? node.getAttribute("alt") ?? "";
      const src = node.getAttribute("data-src") ?? node.getAttribute("src") ?? "";
      const sizeSpec = node.getAttribute("data-size") || "";
      const size = sizeSpec ? parseSizeSpec(sizeSpec) : { type: "none" as const };
      return buildImageMarkdown({ alt, src, size });
    },
  });
}

/* -------------------------- preview separator ---------------------------- */
/**
 * `--END PREVIEW--` on its own line marks where the feed preview should stop.
 * It renders as an <hr> carrying `data-preview-end="1"` so it round-trips back
 * to the marker via turndown, and so the feed can split the stored HTML on it
 * (see `extractPreviewHtml`) to show everything before it — full code blocks and
 * all — instead of the automatic character-truncated preview.
 */
export const PREVIEW_END_MARKER = "--END PREVIEW--";

/** Canonical HTML for the preview separator. */
export function buildPreviewEndHtml(): string {
  return `<hr data-preview-end="1" class="cb-preview-end" />`;
}

/** Matches the stored preview-separator <hr> (any attribute order). */
export const PREVIEW_END_HTML_RE = /<hr\b[^>]*\bdata-preview-end\b[^>]*>/i;

/**
 * If `html` contains the preview separator, return the HTML *before* it
 * (trimmed); otherwise return null. Used by the feed to render an HTML preview
 * that stops exactly at the marker rather than truncating plain text.
 */
export function extractPreviewHtml(html: string): string | null {
  const m = PREVIEW_END_HTML_RE.exec(html);
  if (!m) return null;
  return html.slice(0, m.index).trim();
}

/** Matches the `--END PREVIEW--` marker as its own block at the input start. */
const PREVIEW_END_RULE = /^--END PREVIEW--[ \t]*(?:\n+|$)/;

/**
 * Register the `--END PREVIEW--` block tokenizer + renderer on a marked
 * instance. Idempotent per-instance via a private flag.
 */
export function registerPreviewEndExtension(marked: {
  use: (...args: import("marked").MarkedExtension[]) => typeof marked;
}): void {
  const flagged = marked as unknown as { __cbPreviewEnd?: boolean };
  if (flagged.__cbPreviewEnd) return;
  flagged.__cbPreviewEnd = true;

  marked.use({
    extensions: [
      {
        name: "previewEnd",
        level: "block",
        start(src: string) {
          const i = src.indexOf("--END PREVIEW--");
          return i < 0 ? undefined : i;
        },
        tokenizer(src: string) {
          const m = PREVIEW_END_RULE.exec(src);
          if (!m) return undefined;
          return { type: "previewEnd", raw: m[0] };
        },
        renderer() {
          return `${buildPreviewEndHtml()}\n`;
        },
      },
    ],
  });
}

/**
 * Add a turndown rule that collapses the preview-separator <hr> back into the
 * `--END PREVIEW--` marker. Only matches HRs carrying `data-preview-end`; plain
 * horizontal rules fall through to turndown's default handling.
 */
export function addPreviewEndTurndownRule(turndown: {
  addRule: (key: string, rule: unknown) => void;
}): void {
  turndown.addRule("cbPreviewEnd", {
    filter: (node: HTMLElement) =>
      node.nodeType === 1 &&
      node.nodeName === "HR" &&
      typeof node.getAttribute === "function" &&
      node.getAttribute("data-preview-end") != null,
    replacement: () => `\n\n${PREVIEW_END_MARKER}\n\n`,
  });
}

/**
 * Matches a single `@[bracket](url)` tag at the start of the input. The bracket
 * is optional (`*`) so bare URL embeds (`@[](url)`) tokenize as well as file
 * embeds (`@[name.ext](url)`).
 */
const ATTACHMENT_RULE = /^@\[([^\]]*)\]\(\s*([^)\s]+)\s*\)/;

/**
 * Register the `@[name](url)` block tokenizer + renderer on a marked instance.
 * Idempotent per-instance via a private flag.
 */
export function registerEmbedExtension(marked: {
  use: (...args: import("marked").MarkedExtension[]) => typeof marked;
}): void {
  // Sized images share the same markdown feature set; register them here so
  // every embed-enabled marked instance also understands `![alt](url){spec}`.
  registerImageSizeExtension(marked);
  // The `--END PREVIEW--` separator is part of the same authoring toolkit.
  registerPreviewEndExtension(marked);

  const flagged = marked as unknown as { __cbEmbed?: boolean };
  if (flagged.__cbEmbed) return;
  flagged.__cbEmbed = true;

  marked.use({
    extensions: [
      {
        name: "attachment",
        level: "block",
        start(src: string) {
          const i = src.indexOf("@[");
          return i < 0 ? undefined : i;
        },
        tokenizer(src: string) {
          const m = ATTACHMENT_RULE.exec(src);
          if (!m) return undefined;
          const bracketContent = m[1] ?? "";
          const href = m[2] ?? "";

          // External http(s) pages (not local uploads / not direct file links)
          // are URL embeds: the bracket carries only size + `urlOnly`.
          if (shouldTreatAsUrlEmbed(href)) {
            const { size, urlOnly } = parseUrlBracket(bracketContent);
            return {
              type: "attachment",
              raw: m[0],
              embedType: "url",
              href,
              size,
              urlOnly,
            };
          }

          // Parse the bracket content to separate name from size spec
          // Format: "name size" or just "name"
          const trimmed = bracketContent.trim();
          let name = trimmed;
          let sizeSpec = "";

          // Try to find a size spec at the end
          // Size specs are: WxH, W%, small/medium/large, width=W, etc.
          const sizePatterns = [
            /\s+(\d+x\d+)\s*$/i,           // 640x360
            /\s+(\d+%)\s*$/,               // 50%
            /\s+(small|medium|large)\s*$/i, // preset
            /\s+(width=\d+(?:\s+height=\d+)?)\s*$/i, // named params
          ];

          for (const pattern of sizePatterns) {
            const match = trimmed.match(pattern);
            if (match) {
              sizeSpec = match[1];
              name = trimmed.slice(0, match.index).trim();
              break;
            }
          }

          const size = sizeSpec ? parseSizeSpec(sizeSpec) : { type: "none" as const };
          return {
            type: "attachment",
            raw: m[0],
            embedType: "file",
            name,
            href,
            size,
          };
        },
        renderer(token: import("marked").Tokens.Generic) {
          const t = token as unknown as {
            embedType?: string;
            name?: string;
            href: string;
            size?: EmbedSize;
            urlOnly?: boolean;
          };
          if (t.embedType === "url") {
            return buildUrlEmbedHtml({ url: t.href, size: t.size, urlOnly: t.urlOnly });
          }
          return buildEmbedHtml({ name: t.name ?? "", src: t.href, size: t.size });
        },
      },
    ],
  });
}

/**
 * Add a turndown rule that collapses embed HTML back into the `@[name](url)`
 * tag. Pass the turndown instance (kept generic to avoid a hard type import).
 */
export function addEmbedTurndownRule(turndown: {
  addRule: (key: string, rule: unknown) => void;
}): void {
  // Sized images belong to the same round-trip system; register their rule so
  // every embed-enabled turndown instance collapses them back to markdown.
  addImageTurndownRule(turndown);
  // Collapse the preview-separator <hr> back to `--END PREVIEW--`.
  addPreviewEndTurndownRule(turndown);

  turndown.addRule("cbEmbed", {
    filter: (node: HTMLElement) =>
      node.nodeType === 1 &&
      typeof node.getAttribute === "function" &&
      node.getAttribute("data-embed") === "1",
    replacement: (_content: string, node: HTMLElement) => {
      const src = node.getAttribute("data-src") || "";
      const sizeSpec = node.getAttribute("data-size") || "";
      const size = sizeSpec ? parseSizeSpec(sizeSpec) : { type: "none" as const };

      // URL embeds (rich provider, generic preview, or plain link) collapse to
      // `@[size? urlOnly?](url)`; file/media embeds collapse to `@[name size](url)`.
      if (node.getAttribute("data-embed-type") === "url") {
        const urlOnly = node.getAttribute("data-url-only") === "1";
        return `\n\n${buildUrlEmbedMarkdown({ url: src, size, urlOnly })}\n\n`;
      }

      const name = node.getAttribute("data-name") || "";
      return `\n\n${buildEmbedMarkdown({ name, src, size })}\n\n`;
    },
  });

  // Add rule for code blocks to preserve the language and the preview/collapse
  // line count. Handles both bare `<pre><code>` blocks and the `.cb-code`
  // wrapper used for collapsible blocks, round-tripping back to fenced markdown.
  turndown.addRule("codeBlock", {
    filter: (node: HTMLElement) =>
      node.nodeType === 1 &&
      node.nodeName === "PRE" &&
      node.firstChild?.nodeName === "CODE",
    replacement: (_content: string, node: HTMLElement) => {
      const code = node.firstChild as HTMLElement;
      const langMatch = code.className.match(/language-([\w+#-]+)/);
      const lang = langMatch ? langMatch[1] : "";

      // Extract code content without extra whitespace
      const codeContent = (code.textContent || "").replace(/\n$/, "");

      // `.cb-code` wrappers carry the optional size (data-size) and, when
      // collapsible, the line count + keyword (preview/collapse). Reconstruct
      // the info string as `lang [size] [preview|collapse=N]`.
      const wrapper = node.closest(".cb-code") as HTMLElement | null;
      const size = wrapper?.getAttribute("data-size");
      const previewLines = wrapper?.getAttribute("data-preview-lines");
      const kind = wrapper?.getAttribute("data-collapse-kind") || "preview";

      let info = lang;
      if (size) info += ` ${size}`;
      if (previewLines) info += ` ${kind}=${previewLines}`;

      return `\n\n\`\`\`${info}\n${codeContent}\n\`\`\`\n\n`;
    },
  });

  // Skip the language header so its label/icon never leak into markdown.
  turndown.addRule("codeBlockHeader", {
    filter: (node: HTMLElement) =>
      node.nodeType === 1 &&
      node.nodeName === "DIV" &&
      node.classList.contains("cb-code__header"),
    replacement: () => "",
  });

  // Skip the collapse/expand toggle bar so it never leaks into markdown.
  turndown.addRule("codeBlockToggle", {
    filter: (node: HTMLElement) =>
      node.nodeType === 1 &&
      node.nodeName === "BUTTON" &&
      node.classList.contains("cb-code__toggle"),
    replacement: () => "",
  });

  // Unwrap the `.cb-code` container, leaving its inner <pre> to be handled by
  // the codeBlock rule above.
  turndown.addRule("codeBlockWrapper", {
    filter: (node: HTMLElement) =>
      node.nodeType === 1 &&
      node.nodeName === "DIV" &&
      node.classList.contains("cb-code"),
    replacement: (content: string) => content,
  });
}
