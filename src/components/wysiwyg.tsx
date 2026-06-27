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
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  FILE_ACCEPT,
  buildEmbedHtml,
  buildEmbedMarkdown,
  registerEmbedExtension,
  addEmbedTurndownRule,
} from "@/lib/embeds";
import {
  initHighlightJs,
  loadHighlightJsCss,
  loadHighlightJsLanguage,
  getHljsModule,
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

// Parse code block info string to extract language and preview lines
// Format: "language preview=N" or just "language"
function parseCodeBlockInfo(info: string): { language: string; previewLines?: number } {
  const parts = info.trim().split(/\s+/);
  const language = parts[0] || "plaintext";
  const previewMatch = info.match(/preview=(\d+)/);
  const previewLines = previewMatch ? parseInt(previewMatch[1], 10) : undefined;
  return { language, previewLines };
}

// Configure marked to use highlight.js for syntax highlighting (lazy-loaded)
marked.use({
  renderer: {
    code(code: string, language: string | undefined) {
      const { language: lang, previewLines } = parseCodeBlockInfo(language || "");
      const hljs = getHljsModule();

      // Determine if we should use hljs-dark (for hacker theme)
      const theme = typeof document !== "undefined" ? document.documentElement.getAttribute("data-theme") : "hacker";
      const hljsClass = theme === "hacker" ? "hljs-dark" : "hljs";

      // If highlight.js is not loaded yet, return plain code
      if (!hljs) {
        if (previewLines) {
          const lines = code.split("\n");
          const isCollapsed = lines.length > previewLines;
          const collapsedHeight = `${previewLines * 1.5}em`; // Approx 1.5em per line
          return `
            <div class="code-block-wrapper collapsed" data-lines="${lines.length}" data-preview-lines="${previewLines}">
              <pre data-preview-lines="${previewLines}" style="--preview-height: ${collapsedHeight};"><code class="language-${lang}">${code}</code></pre>
              ${isCollapsed ? `
                <button class="code-expand-btn" type="button">
                  <span class="icon"><svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'></polyline></svg></span>
                  <span class="text">Expand</span>
                </button>
              ` : ""}
            </div>
          `;
        }
        return `<pre><code class="language-${lang}">${code}</code></pre>`;
      }

      // Check if the language is registered
      const validLang = lang && hljs.getLanguage(lang) ? lang : "plaintext";

      try {
        const highlighted = hljs.highlight(code, { language: validLang }).value;

        if (previewLines) {
          const lines = code.split("\n");
          const isCollapsed = lines.length > previewLines;
          const collapsedHeight = `${previewLines * 1.5}em`; // Approx 1.5em per line
          return `
            <div class="code-block-wrapper collapsed" data-lines="${lines.length}" data-preview-lines="${previewLines}">
              <pre data-preview-lines="${previewLines}" style="--preview-height: ${collapsedHeight};"><code class="language-${validLang} ${hljsClass}">${highlighted}</code></pre>
              ${isCollapsed ? `
                <button class="code-expand-btn" type="button">
                  <span class="icon"><svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'></polyline></svg></span>
                  <span class="text">Expand</span>
                </button>
              ` : ""}
            </div>
          `;
        }

        return `<pre><code class="language-${validLang} ${hljsClass}">${highlighted}</code></pre>`;
      } catch (error) {
        console.error("Highlight.js error:", error);
        // Fallback to plain code if highlighting fails
        return `<pre><code class="language-${validLang}">${code}</code></pre>`;
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

  // Initialize rich content and keep it in sync with value prop.
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) {
      ref.current.innerHTML = value;
    }
  }, [value]);

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

  // Add event listeners to code block expand buttons in preview
  useEffect(() => {
    if (mode === "md" && previewRef.current) {
      const buttons = previewRef.current.querySelectorAll(".code-expand-btn");
      buttons.forEach((button) => {
        button.addEventListener("click", (e) => {
          const target = e.currentTarget as HTMLElement;
          const wrapper = target.closest(".code-block-wrapper") as HTMLElement;
          if (wrapper) {
            wrapper.classList.toggle("collapsed");
            wrapper.classList.toggle("expanded");
            const icon = target.querySelector(".icon");
            const text = target.querySelector(".text");
            if (icon && text) {
              const isCollapsed = wrapper.classList.contains("collapsed");
              if (isCollapsed) {
                icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
                text.textContent = "Expand";
              } else {
                icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>';
                text.textContent = "Collapse";
              }
            }
          }
        });
      });
    }
  }, [mode, md]);

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
    // Sync the contentEditable surface after render.
    requestAnimationFrame(() => {
      if (ref.current) ref.current.innerHTML = html;
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
