"use client";

/**
 * Dual-mode article editor: rich WYSIWYG (contentEditable) or Markdown with live
 * preview. The value is always HTML; switching to Markdown converts HTML→md on
 * entry and md→HTML on exit via `turndown` and `marked`. Image upload (admin
 * only) inserts <img> into the active surface.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  SeparatorHorizontal,
  Globe,
  ChevronLeft,
  ChevronRight,
  Scaling,
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
  buildUrlEmbedHtml,
  buildUrlEmbedMarkdown,
  buildPreviewEndHtml,
  PREVIEW_END_MARKER,
  registerEmbedExtension,
  addEmbedTurndownRule,
  isExternalHttpUrl,
} from "@/lib/embeds";
import {
  parseCodeBlockInfo,
  buildCodeBlock,
  escapeCode,
} from "@/lib/code-block-render";
import { hydrateLinkEmbeds } from "@/lib/link-embeds";
import {
  findSizableElement,
  selectionNode,
  readSizable,
  renderSizable,
  type SizableTarget,
} from "@/lib/embed-sizing";
import { collapseBase64, expandBase64 } from "@/lib/base64-placeholders";
import { EmbedSizeDialog } from "@/components/embed-size-dialog";
import {
  initHighlightJs,
  loadHighlightJsCss,
  loadHighlightJsLanguage,
  getHljsModule,
  wireCodeBlockToggles,
  type CodeToggleOptions,
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

/* ------------------ caret preservation across mode switch ---------------- */
// "Blocks" are the top-level children of the rich surface and the blank-line
// separated segments of the markdown source. We anchor the caret to the block
// it currently sits in ("the equivalent element above it") and, after the mode
// switch, drop the caret at the end of the matching block — or at the very
// start if none maps across.

/** Index of the top-level block in `root` that contains the current caret. */
function getRichCaretBlockIndex(root: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  let node: Node | null = sel.getRangeAt(0).startContainer;
  if (!node || !root.contains(node)) return 0;
  while (node && node.parentNode !== root) node = node.parentNode;
  if (!node) return 0;
  const idx = Array.from(root.children).indexOf(node as Element);
  return idx < 0 ? 0 : idx;
}

/** Drop the caret at the end of the `index`-th top-level block (start if none). */
function placeRichCaretAtBlock(root: HTMLElement, index: number): void {
  const sel = window.getSelection();
  if (!sel) return;
  const blocks = Array.from(root.children);
  const range = document.createRange();
  const target = index >= 0 ? blocks[Math.min(index, blocks.length - 1)] : undefined;
  if (target) {
    range.selectNodeContents(target);
    range.collapse(false); // end of the equivalent block
  } else {
    range.selectNodeContents(root);
    range.collapse(true); // start
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Char ranges of each blank-line-separated markdown block. */
function mdBlockRanges(md: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const re = /\n[ \t]*\n/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    ranges.push({ start, end: m.index });
    start = m.index + m[0].length;
  }
  ranges.push({ start, end: md.length });
  return ranges;
}

/** Index of the markdown block containing the textarea caret. */
function getMdCaretBlockIndex(ta: HTMLTextAreaElement): number {
  const pos = ta.selectionStart ?? 0;
  const ranges = mdBlockRanges(ta.value);
  for (let i = 0; i < ranges.length; i++) {
    if (pos <= ranges[i]!.end) return i;
  }
  return Math.max(0, ranges.length - 1);
}

/** Drop the textarea caret at the end of the `index`-th block (start if none). */
function placeMdCaretAtBlock(ta: HTMLTextAreaElement, index: number): void {
  const ranges = mdBlockRanges(ta.value);
  if (index < 0 || ranges.length === 0) {
    ta.setSelectionRange(0, 0);
    return;
  }
  const pos = ranges[Math.min(index, ranges.length - 1)]!.end;
  ta.setSelectionRange(pos, pos);
}

export function Wysiwyg({ value, onChange }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mdRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const attachRef = useRef<HTMLInputElement>(null);
  // Block index captured at toggle time, applied to the textarea once it mounts.
  const pendingCaretRef = useRef<number | null>(null);
  const toast = useToast();
  const [mode, setMode] = useState<"rich" | "md">("rich");
  const [md, setMd] = useState("");
  const [hljsReady, setHljsReady] = useState(false);
  const [hljsInitialized, setHljsInitialized] = useState(false);
  // Live-preview pane collapse state (markdown mode). When collapsed the preview
  // is not rendered and its HTML is never computed (see previewHtml below).
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  // Remembers which code blocks the editor expanded, keyed by block index, so
  // the state survives the markdown preview being re-injected via
  // `dangerouslySetInnerHTML` on every keystroke / highlight pass (otherwise an
  // expanded block would flicker back to collapsed as you type).
  const expandedBlocksRef = useRef<Set<number>>(new Set());
  // Base64 data URLs are collapsed to "[base64 data]" placeholders in the
  // markdown textarea; this store maps them back for rendering/saving.
  const base64StoreRef = useRef<Map<string, string>>(new Map());
  // Currently selected size-capable element in rich mode (never marked in the
  // DOM — innerHTML is serialized on save) and its dialog snapshot.
  const [sizeTarget, setSizeTarget] = useState<HTMLElement | null>(null);
  const [sizeDialog, setSizeDialog] = useState<SizableTarget | null>(null);

  const codeToggleOptions = useMemo<CodeToggleOptions>(
    () => ({
      isExpanded: (i) => expandedBlocksRef.current.has(i),
      onToggle: (i, expanded) => {
        if (expanded) expandedBlocksRef.current.add(i);
        else expandedBlocksRef.current.delete(i);
      },
    }),
    [],
  );

  // Markdown -> HTML with base64 placeholders expanded back to real data URLs.
  const mdToHtml = useCallback(
    (source: string) => marked(expandBase64(source, base64StoreRef.current)) as string,
    [],
  );

  // Preview HTML for markdown mode. Collapsed preview skips the marked() render
  // entirely so typing stays cheap when the pane is hidden. `hljsReady` re-runs
  // it once highlight.js loads. Note: this only feeds the *visible* preview; the
  // saved value is emitted independently by the onChange effect below, so
  // collapsing the preview never affects the data written on save.
  const previewHtml = useMemo(
    () => (previewCollapsed ? "" : mdToHtml(md)),
    [md, previewCollapsed, hljsReady, mdToHtml],
  );

  // Same identity concern as the article body: a fresh { __html } object on
  // every render makes React re-parse the preview and drop hydrated embeds.
  const previewMarkup = useMemo(() => ({ __html: previewHtml }), [previewHtml]);

  // Initialize rich content and keep it in sync with value prop. Re-wire the
  // code block collapse toggles after every sync so they work in rich mode too
  // (e.g. right after clicking Edit on an existing article).
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) {
      ref.current.innerHTML = value;
    }
    if (mode === "rich" && ref.current) {
      wireCodeBlockToggles(ref.current, codeToggleOptions);
      hydrateLinkEmbeds(ref.current);
    }
  }, [value, mode, codeToggleOptions]);

  // Clear markdown state when switching to rich mode. Reset persisted block
  // state too, since indices belong to the previously rendered content.
  useEffect(() => {
    if (mode === "rich") {
      setMd("");
    }
    expandedBlocksRef.current.clear();
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
      const html = mdToHtml(md);
      onChange(html);
    }
  }, [md, mode, onChange, hljsInitialized, mdToHtml]);

  // Re-render markdown when hljs becomes ready
  useEffect(() => {
    if (hljsReady && mode === "md" && md) {
      const html = mdToHtml(md);
      onChange(html);
    }
  }, [hljsReady, mode, md, onChange, mdToHtml]);

  // Wire the code block collapse/expand toggle bars in the markdown preview.
  // Re-runs whenever the rendered markdown changes or hljs becomes ready. The
  // delegated listener lives on the stable preview container, and the persisted
  // options keep blocks expanded across the per-keystroke re-injection.
  useEffect(() => {
    if (mode === "md" && !previewCollapsed && previewRef.current) {
      wireCodeBlockToggles(previewRef.current, codeToggleOptions);
      hydrateLinkEmbeds(previewRef.current);
    }
  }, [mode, md, hljsReady, codeToggleOptions, previewCollapsed]);

  // When toggling to md, convert current HTML → md.
  const toggleToMd = useCallback(() => {
    // Capture the caret's block position before the surface is torn down.
    const caretIdx = ref.current ? getRichCaretBlockIndex(ref.current) : 0;
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
    // Show base64 image payloads as short placeholders in the textarea; the
    // store lets mdToHtml expand them again for preview/save.
    const { md: collapsed, store } = collapseBase64(markdown);
    base64StoreRef.current = store;
    pendingCaretRef.current = caretIdx;
    setMd(collapsed);
    setSizeTarget(null);
    setMode("md");
  }, [value]);

  // When toggling to rich, convert md → HTML and emit.
  const toggleToRich = useCallback(() => {
    // Capture the caret's markdown block before conversion.
    const caretIdx = mdRef.current ? getMdCaretBlockIndex(mdRef.current) : 0;
    const html = mdToHtml(md);
    onChange(html);
    setMd(""); // Clear markdown state when switching back to rich
    setMode("rich");
    // Sync the contentEditable surface after render, then wire code toggles and
    // hand the caret off to the equivalent block, focusing seamlessly.
    requestAnimationFrame(() => {
      if (ref.current) {
        ref.current.innerHTML = html;
        wireCodeBlockToggles(ref.current, codeToggleOptions);
        hydrateLinkEmbeds(ref.current);
        ref.current.focus();
        placeRichCaretAtBlock(ref.current, caretIdx);
      }
    });
  }, [md, onChange, codeToggleOptions, mdToHtml]);

  // After switching to Markdown, restore the caret to the block mirroring the
  // rich-mode position and focus the textarea (seamless hand-off). Guarded by
  // pendingCaretRef so it only fires on an actual mode toggle, not keystrokes.
  useEffect(() => {
    if (mode !== "md" || pendingCaretRef.current === null) return;
    const idx = pendingCaretRef.current;
    pendingCaretRef.current = null;
    const ta = mdRef.current;
    if (!ta) return;
    requestAnimationFrame(() => {
      ta.focus();
      placeMdCaretAtBlock(ta, idx);
    });
  }, [mode, md]);

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

  // Insert the `--END PREVIEW--` separator at the caret in either mode. In rich
  // mode it drops the <hr data-preview-end> chrome; in markdown mode it splices
  // the marker in at the textarea caret (falling back to an append).
  const insertPreviewSeparator = useCallback(() => {
    if (mode === "rich") {
      insertHtml(buildPreviewEndHtml());
      return;
    }
    const ta = mdRef.current;
    if (ta) {
      const start = ta.selectionStart ?? md.length;
      const end = ta.selectionEnd ?? md.length;
      setMd(`${md.slice(0, start)}\n\n${PREVIEW_END_MARKER}\n\n${md.slice(end)}`);
    } else {
      setMd((prev) => `${prev}\n\n${PREVIEW_END_MARKER}\n\n`);
    }
  }, [mode, md, insertHtml]);

  const handleInput = useCallback(() => {
    if (ref.current) onChange(ref.current.innerHTML);
  }, [onChange]);

  // Insert an external URL embed (rich provider embed or generic link preview).
  // Works in both modes; rich mode also hydrates the freshly inserted card.
  const handleInsertLinkEmbed = useCallback(() => {
    const raw = prompt("Embed URL (YouTube, SoundCloud, Vimeo, X, …)");
    if (!raw) return;
    const url = raw.trim();
    if (!isExternalHttpUrl(url)) {
      toast.error("Enter a full http(s) URL");
      return;
    }
    if (mode === "rich") {
      insertHtml(buildUrlEmbedHtml({ url }));
      requestAnimationFrame(() => hydrateLinkEmbeds(ref.current));
    } else {
      setMd((prev) => `${prev}\n\n${buildUrlEmbedMarkdown({ url })}\n\n`);
    }
  }, [insertHtml, mode, toast]);

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
    disabled,
    testId,
  }: {
    onClick: () => void;
    title: string;
    children: React.ReactNode;
    disabled?: boolean;
    testId?: string;
  }) => (
    <button
      type="button"
      title={title}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className="rounded p-2 text-fg transition-colors hover:bg-border/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );

  // Size toolbar: open the dialog for the tracked element, or clear it when
  // the element left the editor (e.g. after an undo).
  const handleSizeClick = useCallback(() => {
    if (!sizeTarget || !ref.current || !ref.current.contains(sizeTarget)) {
      setSizeTarget(null);
      return;
    }
    const t = readSizable(sizeTarget);
    if (t) setSizeDialog(t);
  }, [sizeTarget]);

  // Apply dialog edits: swap the element for a freshly rendered one, then
  // re-wire toggles/hydration and emit the updated HTML.
  const handleSizeApply = useCallback(
    (next: SizableTarget) => {
      setSizeDialog(null);
      const el = sizeTarget;
      const root = ref.current;
      if (!el || !root || !root.contains(el)) return;
      const tpl = document.createElement("template");
      tpl.innerHTML = renderSizable(next);
      const fresh = tpl.content.firstElementChild as HTMLElement | null;
      if (!fresh) return;
      el.replaceWith(fresh);
      setSizeTarget(fresh);
      wireCodeBlockToggles(root, codeToggleOptions);
      hydrateLinkEmbeds(root);
      onChange(root.innerHTML);
    },
    [sizeTarget, codeToggleOptions, onChange],
  );

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-1 rounded-t-md border-b border-border bg-card/90 p-1.5 backdrop-blur">
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
              <Btn
                title="Size & layout"
                testId="size-button"
                disabled={!sizeTarget}
                onClick={handleSizeClick}
              >
                <Scaling className="h-4 w-4" />
              </Btn>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Btn title="Insert preview separator (--END PREVIEW--)" onClick={insertPreviewSeparator}>
            <SeparatorHorizontal className="h-4 w-4" />
          </Btn>
          <Btn title="Embed link (YouTube, SoundCloud, Vimeo, X…)" onClick={handleInsertLinkEmbed}>
            <Globe className="h-4 w-4" />
          </Btn>
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
          onClick={(e) => {
            if (ref.current) {
              setSizeTarget(findSizableElement(e.target as Node, ref.current));
            }
          }}
          onKeyUp={() => {
            if (ref.current) {
              setSizeTarget(
                findSizableElement(selectionNode(window.getSelection()), ref.current),
              );
            }
          }}
          className="article-body min-h-[260px] px-4 py-3 text-fg outline-none"
          suppressContentEditableWarning
        />
      ) : (
        <div className="flex">
          <textarea
            ref={mdRef}
            value={md}
            onChange={(e) => setMd(e.target.value)}
            className={`article-body min-h-[260px] bg-bg px-4 py-3 text-fg outline-none resize-none ${
              previewCollapsed ? "flex-1" : "w-1/2"
            }`}
            placeholder="Write in Markdown..."
          />
          {/* Thin, clickable divider that collapses/expands the live preview.
              While collapsed, the preview below is not rendered at all, so its
              marked() HTML is never computed. */}
          <button
            type="button"
            data-testid="md-preview-toggle"
            onClick={() => setPreviewCollapsed((v) => !v)}
            title={previewCollapsed ? "Show preview" : "Hide preview"}
            aria-label={previewCollapsed ? "Show preview" : "Hide preview"}
            aria-expanded={!previewCollapsed}
            className="flex w-4 flex-none cursor-pointer items-center justify-center border-l border-border bg-card/60 text-muted transition-colors hover:bg-border/40 hover:text-fg"
          >
            {previewCollapsed ? (
              <ChevronLeft className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
          {!previewCollapsed && (
            <div
              ref={previewRef}
              data-testid="md-preview"
              className="article-body min-h-[260px] w-1/2 overflow-auto px-4 py-3 text-fg"
              dangerouslySetInnerHTML={previewMarkup}
            />
          )}
        </div>
      )}

      {sizeDialog && (
        <EmbedSizeDialog
          target={sizeDialog}
          onApply={handleSizeApply}
          onClose={() => setSizeDialog(null)}
        />
      )}
    </div>
  );
}
