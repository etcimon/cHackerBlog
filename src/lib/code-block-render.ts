/**
 * Shared code-block rendering utilities used by both the WYSIWYG editor
 * (client-side live preview) and the Grok translation pipeline (server-side
 * markdown→HTML conversion). Extracting these here guarantees translated
 * articles produce the same `.cb-code` wrapper structure as the editor, so
 * collapse/expand toggles, preview line limiting, and size constraints all
 * work identically regardless of whether the HTML was authored or translated.
 */
import { parseSizeSpec, sizeSpecToString, type EmbedSize } from "@/lib/embeds";

export interface CodeBlockInfo {
  language: string;
  previewLines?: number;
  collapseKind: "preview" | "collapse";
  size: EmbedSize;
}

/**
 * Parse a code block info string into its language, optional preview/collapse
 * line count, and optional size. Tokens after the language can appear in any
 * order, e.g. "ts small preview=5", "python width=300 collapse=8".
 */
export function parseCodeBlockInfo(info: string): CodeBlockInfo {
  const trimmed = info.trim();
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const language = tokens[0] || "plaintext";

  let previewLines: number | undefined;
  let collapseKind: "preview" | "collapse" = "preview";
  const pc = trimmed.match(/\b(preview|collapse)=(\d+)/i);
  if (pc) {
    collapseKind = pc[1].toLowerCase() as "preview" | "collapse";
    previewLines = parseInt(pc[2], 10);
  }

  const sizeSpec = tokens
    .slice(1)
    .filter((t) => !/^(preview|collapse)=\d+$/i.test(t))
    .join(" ")
    .trim();
  const size: EmbedSize = sizeSpec ? parseSizeSpec(sizeSpec) : { type: "none" };

  return { language, previewLines, collapseKind, size };
}

/** Escape raw code for safe insertion when highlight.js hasn't highlighted it. */
export function escapeCode(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const LANG_LABELS: Record<string, string> = {
  javascript: "JavaScript",
  typescript: "TypeScript",
  tsx: "TSX",
  jsx: "JSX",
  python: "Python",
  ruby: "Ruby",
  bash: "Bash",
  shell: "Shell",
  json: "JSON",
  yaml: "YAML",
  xml: "HTML",
  html: "HTML",
  css: "CSS",
  scss: "SCSS",
  markdown: "Markdown",
  cpp: "C++",
  csharp: "C#",
  fsharp: "F#",
  go: "Go",
  rust: "Rust",
  kotlin: "Kotlin",
  swift: "Swift",
  java: "Java",
  php: "PHP",
  sql: "SQL",
  d: "D",
  plaintext: "Text",
};

export function langLabel(lang: string): string {
  const key = (lang || "plaintext").toLowerCase();
  return LANG_LABELS[key] || lang.toUpperCase();
}

const CODE_ICON_SVG =
  "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polyline points=\"16 18 22 12 16 6\"></polyline><polyline points=\"8 6 2 12 8 18\"></polyline></svg>";

const CARET_SVG =
  "<svg class=\"cb-code__caret\" xmlns=\"http://www.w3.org/2000/svg\" width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polyline points=\"6 9 12 15 18 9\"></polyline></svg>";

function codeSizeStyle(size: EmbedSize): { cls: string; style: string } {
  switch (size.type) {
    case "pixels":
      return { cls: "cb-code--size-pixels", style: `max-width:${size.width}px;` };
    case "percent":
      return { cls: "cb-code--size-percent", style: `width:${size.width}%;` };
    case "preset":
      return { cls: `cb-code--size-${size.size}`, style: "" };
    default:
      return { cls: "", style: "" };
  }
}

/**
 * Build the rendered HTML for a code block. Every block gets a header showing a
 * code icon + the language name. When a preview/collapse count is given and the
 * code is longer than it, a bottom toggle bar is appended and the block starts
 * collapsed; the collapsed height is N lines expressed in `em` (font-size
 * aware) via the `--cb-preview-lines` custom property. Optional sizes constrain
 * the block width.
 */
export function buildCodeBlock(
  bodyHtml: string,
  lang: string,
  totalLines: number,
  info: Pick<CodeBlockInfo, "previewLines" | "collapseKind" | "size">,
  highlighted = false,
): string {
  const { previewLines, collapseKind, size } = info;
  const codeClass = `language-${lang}${highlighted ? " hljs" : ""}`;
  const collapsible = !!previewLines && totalLines > previewLines;

  const { cls: sizeCls, style: sizeStyle } = codeSizeStyle(size);
  const sizeSpec = size.type !== "none" ? sizeSpecToString(size) : "";

  const header =
    `<div class="cb-code__header" contenteditable="false">` +
    `<span class="cb-code__lang-icon">${CODE_ICON_SVG}</span>` +
    `<span class="cb-code__lang">${langLabel(lang)}</span>` +
    `</div>`;

  const pre = `<pre class="cb-code__pre"><code class="${codeClass}">${bodyHtml}</code></pre>`;

  const toggle = collapsible
    ? `<button class="cb-code__toggle" type="button" contenteditable="false" ` +
      `aria-label="Expand code" aria-expanded="false">${CARET_SVG}</button>`
    : "";

  const wrapperClass = `cb-code${collapsible ? " collapsed" : ""}${sizeCls ? ` ${sizeCls}` : ""}`;

  const styleParts: string[] = [];
  if (sizeStyle) styleParts.push(sizeStyle);
  if (collapsible) styleParts.push(`--cb-preview-lines:${previewLines};`);
  const styleAttr = styleParts.length ? ` style="${styleParts.join(" ")}"` : "";

  const dataAttrs =
    `data-lines="${totalLines}"` +
    (collapsible ? ` data-preview-lines="${previewLines}" data-collapse-kind="${collapseKind}"` : "") +
    (sizeSpec ? ` data-size="${sizeSpec}"` : "");

  return `<div class="${wrapperClass}" ${dataAttrs}${styleAttr}>${header}${pre}${toggle}</div>`;
}
