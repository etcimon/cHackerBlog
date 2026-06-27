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
 */

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

/** Matches a single `@[name size](url)` tag at the start of the input. */
const ATTACHMENT_RULE = /^@\[([^\]]+)\]\(\s*([^)\s]+)\s*\)/;

/**
 * Register the `@[name](url)` block tokenizer + renderer on a marked instance.
 * Idempotent per-instance via a private flag.
 */
export function registerEmbedExtension(marked: {
  use: (...args: unknown[]) => unknown;
}): void {
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
            name,
            href,
            size,
          };
        },
        renderer(token: { name: string; href: string; size?: EmbedSize }) {
          return buildEmbedHtml({ name: token.name, src: token.href, size: token.size });
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
  turndown.addRule("cbEmbed", {
    filter: (node: HTMLElement) =>
      node.nodeType === 1 &&
      typeof node.getAttribute === "function" &&
      node.getAttribute("data-embed") === "1",
    replacement: (_content: string, node: HTMLElement) => {
      const name = node.getAttribute("data-name") || "";
      const src = node.getAttribute("data-src") || "";
      const sizeSpec = node.getAttribute("data-size") || "";
      const size = sizeSpec ? parseSizeSpec(sizeSpec) : { type: "none" as const };
      return `\n\n${buildEmbedMarkdown({ name, src, size })}\n\n`;
    },
  });
}
