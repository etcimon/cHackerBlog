"use client";

/**
 * Dual-mode article editor: rich WYSIWYG (contentEditable) or Markdown with live
 * preview. The value is always HTML; switching to Markdown converts HTML→md on
 * entry and md→HTML on exit via `turndown` and `marked`. Image upload (admin
 * only) inserts <img> into the active surface.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bold,
  Italic,
  Heading2,
  List,
  Link2,
  Code2,
  Quote,
  Image as ImageIcon,
  Paperclip,
  Type,
  Eye,
  EyeOff,
} from "lucide-react";
import { api, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/toast";
// Markdown <-> HTML conversion (client-side only).
import { marked } from "marked";
import TurndownService from "turndown";
import {
  FILE_ACCEPT,
  buildEmbedHtml,
  buildEmbedMarkdown,
  registerEmbedExtension,
  addEmbedTurndownRule,
  parseSizeSpec,
  sizeSpecToString,
  type EmbedSize,
} from "@/lib/embeds";
import {
  initHighlightJs,
  loadHighlightJsCss,
  loadHighlightJsLanguage,
  getHljsModule,
  wireCodeBlockToggles,
} from "@/lib/highlight";

interface Props {
  value: string;
  onChange: (html: string) => void;
}

// Enable the `@[name](url)` attachment tag in markdown rendering globally.
registerEmbedExtension(marked);

// Detect if markdown contains code blocks
function hasCodeBlocks(markdown: string): boolean {
  return /```[\s\S]*?```/.test(markdown);
}

// Extract all languages from code blocks in markdown
function extractLanguages(markdown: string): string[] {
  const regex = /```(\w+)/g;
  const languages = new Set<string>();
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    languages.add(match[1]);
  }
  return Array.from(languages);
}

// Parse a code block info string into its language, optional preview/collapse
// line count, and optional size. Tokens after the language can appear in any
// order, e.g. "ts small preview=5", "python width=300 collapse=8".
// `preview` and `collapse` are aliases; the keyword used is preserved so the
// HTML round-trips back to the same markdown via turndown.
interface CodeBlockInfo {
  language: string;
  previewLines?: number;
  collapseKind: "preview" | "collapse";
  size: EmbedSize;
}

function parseCodeBlockInfo(info: string): CodeBlockInfo {
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

  // Everything after the language, minus the preview/collapse token, is treated
  // as a size spec (small/medium/large, width=N, WxH, N%).
  const sizeSpec = tokens
    .slice(1)
    .filter((t) => !/^(preview|collapse)=\d+$/i.test(t))
    .join(" ")
    .trim();
  const size: EmbedSize = sizeSpec ? parseSizeSpec(sizeSpec) : { type: "none" };

  return { language, previewLines, collapseKind, size };
}

// Escape raw code for safe insertion when highlight.js hasn't highlighted it.
function escapeCode(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Human-friendly labels for the language header; unknown ids are upper-cased.
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

function langLabel(lang: string): string {
  const key = (lang || "plaintext").toLowerCase();
  return LANG_LABELS[key] || lang.toUpperCase();
}

// Lucide "code" glyph for the language header.
const CODE_ICON_SVG =
  "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polyline points=\"16 18 22 12 16 6\"></polyline><polyline points=\"8 6 2 12 8 18\"></polyline></svg>";

// Downward caret (rotated to point up via CSS in the expanded state).
const CARET_SVG =
  "<svg class=\"cb-code__caret\" xmlns=\"http://www.w3.org/2000/svg\" width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polyline points=\"6 9 12 15 18 9\"></polyline></svg>";

// Map a parsed size into a CSS class + inline style for the code wrapper.
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
 * the block width. `contenteditable="false"` keeps the chrome clickable and
 * atomic inside the rich-text surface.
 */
function buildCodeBlock(
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

// Configure marked to use highlight.js for syntax highlighting (lazy-loaded)
marked.use({
  renderer: {
    code(code: string, language: string | undefined) {
      const { language: lang, previewLines, collapseKind, size } = parseCodeBlockInfo(language || "");
      const totalLines = code.split("\n").length;
      const hljs = getHljsModule();

      // If highlight.js isn't loaded yet, emit escaped plain code (the wrapper
      // is re-rendered once hljs becomes ready).
      if (!hljs) {
        return buildCodeBlock(escapeCode(code), lang, totalLines, { previewLines, collapseKind, size }, false);
      }

      const validLang = lang && hljs.getLanguage(lang) ? lang : "plaintext";
      try {
        const highlighted = hljs.highlight(code, { language: validLang }).value;
        return buildCodeBlock(highlighted, validLang, totalLines, { previewLines, collapseKind, size }, true);
      } catch (error) {
        console.error("Highlight.js error:", error);
        return buildCodeBlock(escapeCode(code), validLang, totalLines, { previewLines, collapseKind, size }, false);
      }
    },
  },
});

const turndown = new TurndownService({ headingStyle: "atx" });
addEmbedTurndownRule(turndown);

export function Wysiwyg({ value, onChange }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const attachRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const [mode, setMode] = useState<"rich" | "md">("rich");
  const [md, setMd] = useState("");
  const [hljsReady, setHljsReady] = useState(false);
  const [hljsInitialized, setHljsInitialized] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  // Initialize rich content and keep it in sync with value prop. Re-wire the
  // code block collapse toggles after every sync so they work in rich mode too
  // (e.g. right after clicking Edit on an existing article).
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) {
      ref.current.innerHTML = value;
    }
    if (mode === "rich" && ref.current) {
      wireCodeBlockToggles(ref.current);
    }
  }, [value, mode]);

  // Clear markdown state when switching to rich mode
  useEffect(() => {
    if (mode === "rich") {
      setMd("");
    }
  }, [mode]);

  // When in markdown mode, convert markdown to HTML and emit to parent
  // This ensures the parent always has the HTML representation for saving
  useEffect(() => {
    if (mode === "md" && md) {
      // Lazy load highlight.js, CSS, and required languages only if code blocks are present
      if (hasCodeBlocks(md) && !hljsInitialized) {
        const languages = extractLanguages(md);
        void Promise.all([
          initHighlightJs(),
          loadHighlightJsCss(),
          ...languages.map(lang => loadHighlightJsLanguage(lang))
        ]).then(() => {
          setHljsReady(true);
          setHljsInitialized(true);
        });
      } else if (hasCodeBlocks(md) && hljsInitialized) {
        // Load CSS if not loaded yet and any new languages
        const languages = extractLanguages(md);
        void Promise.all([
          loadHighlightJsCss(),
          ...languages.map(lang => loadHighlightJsLanguage(lang))
        ]).then(() => {
          setHljsReady(true);
        });
      }
      const html = marked(md) as string;
      onChange(html);
    }
  }, [md, mode, onChange, hljsInitialized]);

  // Re-render markdown when hljs becomes ready
  useEffect(() => {
    if (hljsReady && mode === "md" && md) {
      const html = marked(md) as string;
      onChange(html);
    }
  }, [hljsReady, mode, md, onChange]);

  // Wire the code block collapse/expand toggle bars in the markdown preview.
  // Re-runs whenever the rendered markdown changes or hljs becomes ready.
  useEffect(() => {
    if (mode === "md" && previewRef.current) {
      wireCodeBlockToggles(previewRef.current);
    }
  }, [mode, md, hljsReady]);

  // When toggling to md, convert current HTML → md.
  const toggleToMd = useCallback(() => {
    const html = ref.current?.innerHTML ?? value;
    // Clear the contentEditable div immediately to prevent it from showing
    if (ref.current) {
      ref.current.innerHTML = "";
    }
    // Create a fresh turndown instance to avoid any state issues
    const turndownService = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
    });
    // Register the embed rule so embed HTML collapses back to @[name](url)
    addEmbedTurndownRule(turndownService);
    const markdown = turndownService.turndown(html);
    setMd(markdown);
    setMode("md");
  }, [value]);

  // When toggling to rich, convert md → HTML and emit.
  const toggleToRich = useCallback(() => {
    const html = marked(md) as string;
    onChange(html);
    setMd(""); // Clear markdown state when switching back to rich
    setMode("rich");
    // Sync the contentEditable surface after render, then wire code toggles.
    requestAnimationFrame(() => {
      if (ref.current) {
        ref.current.innerHTML = html;
        wireCodeBlockToggles(ref.current);
      }
    });
  }, [md, onChange]);

  const exec = useCallback(
    (command: string, arg?: string) => {
      document.execCommand(command, false, arg);
      ref.current?.focus();
      if (ref.current) onChange(ref.current.innerHTML);
    },
    [onChange],
  );

  // Insert raw HTML at the caret (rich mode) and emit the updated value.
  const insertHtml = useCallback(
    (html: string) => {
      ref.current?.focus();
      document.execCommand("insertHTML", false, `${html}<p><br></p>`);
      if (ref.current) onChange(ref.current.innerHTML);
    },
    [onChange],
  );

  const handleInput = useCallback(() => {
    if (ref.current) onChange(ref.current.innerHTML);
  }, [onChange]);

  const handleUpload = useCallback(
    async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      try {
        const { url } = await api.post<{ url: string }>("/api/upload", fd);
        if (mode === "rich") {
          exec("insertImage", url);
        } else {
          setMd((prev) => `${prev}\n
![image](${url})
`);
        }
        toast.success("Image uploaded");
      } catch (err) {
        toast.error(err instanceof ApiClientError ? err.message : "Upload failed");
      }
    },
    [exec, mode, toast],
  );

  // Upload an arbitrary file (document/video/audio/archive) and insert an
  // attachment embed. Works in both rich and markdown modes.
  const handleFileUpload = useCallback(
    async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      try {
        const { url } = await api.post<{ url: string }>("/api/upload", fd);
        if (mode === "rich") {
          insertHtml(buildEmbedHtml({ name: file.name, src: url }));
        } else {
          setMd((prev) => `${prev}\n\n${buildEmbedMarkdown({ name: file.name, src: url })}\n\n`);
        }
        toast.success("File uploaded");
      } catch (err) {
        toast.error(err instanceof ApiClientError ? err.message : "Upload failed");
      }
    },
    [insertHtml, mode, toast],
  );

  const Btn = ({
    onClick,
    title,
    children,
  }: {
    onClick: () => void;
    title: string;
    children: React.ReactNode;
  }) => (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="rounded p-2 text-fg transition-colors hover:bg-border/40"
    >
      {children}
    </button>
  );

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-1 border-b border-border p-1.5">
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => (mode === "rich" ? toggleToMd() : toggleToRich())}
            title={mode === "rich" ? "Switch to Markdown" : "Switch to rich text"}
            className="rounded p-2 text-fg transition-colors hover:bg-border/40"
          >
            {mode === "rich" ? <Type className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
          {mode === "rich" && (
            <>
              <Btn title="Bold" onClick={() => exec("bold")}>
                <Bold className="h-4 w-4" />
              </Btn>
              <Btn title="Italic" onClick={() => exec("italic")}>
                <Italic className="h-4 w-4" />
              </Btn>
              <Btn title="Heading" onClick={() => exec("formatBlock", "<h2>")}>
                <Heading2 className="h-4 w-4" />
              </Btn>
              <Btn title="Quote" onClick={() => exec("formatBlock", "<blockquote>")}>
                <Quote className="h-4 w-4" />
              </Btn>
              <Btn title="Code block" onClick={() => exec("formatBlock", "<pre>")}>
                <Code2 className="h-4 w-4" />
              </Btn>
              <Btn title="List" onClick={() => exec("insertUnorderedList")}>
                <List className="h-4 w-4" />
              </Btn>
              <Btn
                title="Link"
                onClick={() => {
                  const url = prompt("Link URL");
                  if (url) exec("createLink", url);
                }}
              >
                <Link2 className="h-4 w-4" />
              </Btn>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Btn title="Insert image" onClick={() => fileRef.current?.click()}>
            <ImageIcon className="h-4 w-4" />
          </Btn>
          <Btn title="Attach file (video, audio, document…)" onClick={() => attachRef.current?.click()}>
            <Paperclip className="h-4 w-4" />
          </Btn>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleUpload(f);
            e.target.value = "";
          }}
        />
        <input
          ref={attachRef}
          type="file"
          accept={FILE_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFileUpload(f);
            e.target.value = "";
          }}
        />
      </div>

      {mode === "rich" ? (
        <div
          ref={ref}
          contentEditable
          onInput={handleInput}
          className="article-body min-h-[260px] px-4 py-3 text-fg outline-none"
          suppressContentEditableWarning
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2">
          <textarea
            value={md}
            onChange={(e) => setMd(e.target.value)}
            className="article-body min-h-[260px] border-r border-border bg-bg px-4 py-3 text-fg outline-none resize-none"
            placeholder="Write in Markdown..."
          />
          <div
            ref={previewRef}
            className="article-body min-h-[260px] px-4 py-3 text-fg overflow-auto"
            dangerouslySetInnerHTML={{ __html: marked(md) as string }}
          />
        </div>
      )}
    </div>
  );
}
