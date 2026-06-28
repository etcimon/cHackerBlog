/**
 * Shared highlight.js utilities for syntax highlighting.
 *
 * Used by both the WYSIWYG editor (live markdown preview) and the rendered
 * article body in feed cards. The full highlight.js build is loaded once
 * (registering the ~37 "common" languages), and any additional language is
 * dynamically imported + registered on demand, giving effectively full
 * highlight.js language coverage without bloating the initial bundle.
 *
 * The active syntax theme stylesheet is chosen by the `data-code-theme`
 * attribute on <html> (set server-side from the CODE_THEME env var via
 * resolvedCodeTheme()), e.g. "github-dark", "monokai", "nord".
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let hljsModule: any = null;
let hljsInitialized = false;
let loadedCssTheme: string | null = null;
const loadedLanguages = new Set<string>();

/** Aliases mapping common shorthand language ids to highlight.js module names. */
const LANG_ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  rb: "ruby",
  "c++": "cpp",
  "c#": "csharp",
  cs: "csharp",
  fs: "fsharp",
  vb: "vbnet",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  yml: "yaml",
  md: "markdown",
  htm: "xml",
  html: "xml",
  kt: "kotlin",
  rs: "rust",
  golang: "go",
  ps: "powershell",
  ps1: "powershell",
  text: "plaintext",
  txt: "plaintext",
};

/** Normalise a language id to its canonical highlight.js module name. */
function canonicalLang(language: string): string {
  const lower = (language || "").toLowerCase();
  return LANG_ALIASES[lower] || lower;
}

export async function initHighlightJs() {
  if (hljsInitialized) return;

  try {
    const hljsImport = await import("highlight.js");
    hljsModule = hljsImport.default || hljsImport;
    hljsInitialized = true;
  } catch (error) {
    console.error("Failed to initialize highlight.js:", error);
  }
}

/** The highlight.js stylesheet name configured on <html data-code-theme>. */
function currentCodeTheme(): string {
  if (typeof document !== "undefined") {
    const attr = document.documentElement.getAttribute("data-code-theme");
    if (attr) return attr;
    // Fallback: dark site theme -> github-dark, else github.
    const siteTheme = document.documentElement.getAttribute("data-theme");
    return siteTheme === "hacker" ? "github-dark" : "github";
  }
  return "github-dark";
}

/**
 * Load the configured highlight.js theme stylesheet (once). If the theme
 * changes between calls, the previous stylesheet is swapped out so the page
 * never carries two competing hljs palettes.
 */
export async function loadHighlightJsCss() {
  if (typeof document === "undefined") return;

  const theme = currentCodeTheme();
  if (loadedCssTheme === theme) return;

  const href = `/api/highlightjs/styles/${theme}.css`;
  const linkId = "hljs-theme-css";

  await new Promise<void>((resolve) => {
    let link = document.getElementById(linkId) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = linkId;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    link.onload = () => resolve();
    link.onerror = () => {
      console.error(`Failed to load highlight.js CSS: ${href}`);
      resolve();
    };
    link.href = href;
  });

  loadedCssTheme = theme;
}

export async function loadHighlightJsLanguage(language: string): Promise<void> {
  const hljsLang = canonicalLang(language);
  if (loadedLanguages.has(hljsLang)) return;

  // Already registered by the full build (common language) — nothing to do.
  if (hljsModule && hljsModule.getLanguage(hljsLang)) {
    loadedLanguages.add(hljsLang);
    return;
  }

  try {
    // Import without .js extension as per highlight.js package exports, then
    // register so uncommon languages (outside the common set) highlight too.
    const mod = await import(`highlight.js/lib/languages/${hljsLang}`);
    const def = mod.default ?? mod;
    if (hljsModule && typeof def === "function") {
      hljsModule.registerLanguage(hljsLang, def);
    }
    loadedLanguages.add(hljsLang);
  } catch (error) {
    console.warn(`Failed to load highlight.js language: ${language}`, error);
  }
}

export function hasCodeBlocks(html: string): boolean {
  return /<pre[^>]*><code/.test(html) || /class="[^"]*language-/.test(html);
}

export function extractLanguagesFromHtml(html: string): string[] {
  const regex = /language-([\w+#-]+)/g;
  const languages = new Set<string>();
  let match;
  while ((match = regex.exec(html)) !== null) {
    languages.add(match[1]);
  }
  return Array.from(languages);
}

export async function ensureHighlightJsReady(html: string): Promise<void> {
  if (!hasCodeBlocks(html)) return;

  await Promise.all([initHighlightJs(), loadHighlightJsCss()]);
  const languages = extractLanguagesFromHtml(html);
  await Promise.all(languages.map((lang) => loadHighlightJsLanguage(lang)));
}

export function highlightCodeInElement(element: HTMLElement): void {
  if (!hljsModule) return;

  const codeBlocks = element.querySelectorAll("pre code");
  codeBlocks.forEach((block) => {
    if (block.classList.contains("hljs")) return; // already highlighted
    const langMatch = block.className.match(/language-([\w+#-]+)/);
    const lang = canonicalLang(langMatch ? langMatch[1] : "plaintext");

    try {
      const text = block.textContent || "";
      if (lang !== "plaintext" && hljsModule.getLanguage(lang)) {
        block.innerHTML = hljsModule.highlight(text, { language: lang }).value;
      }
      // The loaded theme stylesheet targets `.hljs`; add it for token colours.
      block.classList.add("hljs");
    } catch (error) {
      console.error("Failed to highlight code block:", error);
    }
  });
}

export interface CodeToggleOptions {
  /**
   * Return whether the collapsible block at `index` (its position among all
   * `.cb-code` wrappers in the element) should currently be expanded. Used to
   * restore state after the body HTML is re-injected by React.
   */
  isExpanded?: (index: number) => boolean;
  /** Notified whenever the user toggles a block, so callers can persist state. */
  onToggle?: (index: number, expanded: boolean) => void;
}

/** Apply the expanded/collapsed classes + ARIA to a wrapper/button pair. */
function applyToggleState(wrap: Element, btn: Element, expanded: boolean): void {
  wrap.classList.toggle("expanded", expanded);
  wrap.classList.toggle("collapsed", !expanded);
  btn.setAttribute("aria-label", expanded ? "Collapse code" : "Expand code");
  btn.setAttribute("aria-expanded", expanded ? "true" : "false");
}

// Latest toggle options per container. Keyed by the (stable, React-owned)
// `.article-body` element so the single delegated listener below always reads
// fresh callbacks, even after the options object identity changes on re-render.
const containerOptions = new WeakMap<HTMLElement, CodeToggleOptions>();

/**
 * Single delegated click handler shared by every wired container.
 *
 * Using delegation (one listener on the stable container) instead of per-button
 * listeners is the crux of the fix: the article body is re-injected via
 * `dangerouslySetInnerHTML` and its code is re-written in place by
 * `highlightCodeInElement`, both of which replace inner nodes. A listener bound
 * to a specific button would be lost (or stranded on a detached node) whenever
 * that happens — the bug seen on feed/scroll-loaded and freshly edited cards.
 * The container node, by contrast, survives all inner mutations, so one
 * listener keeps working for the component's whole lifetime.
 */
function handleContainerClick(this: HTMLElement, ev: Event): void {
  const target = ev.target as HTMLElement | null;
  const btn = target?.closest<HTMLElement>(".cb-code__toggle");
  if (!btn || !this.contains(btn)) return;
  const wrap = btn.closest<HTMLElement>(".cb-code");
  if (!wrap) return;

  // Recompute the block index at click time so it stays correct regardless of
  // how the body was last re-injected/re-highlighted.
  const wraps = Array.from(this.querySelectorAll<HTMLElement>(".cb-code"));
  const index = wraps.indexOf(wrap);

  const expanded = !wrap.classList.contains("expanded");
  applyToggleState(wrap, btn, expanded);
  containerOptions.get(this)?.onToggle?.(index, expanded);
}

/**
 * Wire the collapse/expand toggle bars for code blocks within a container.
 *
 * Safe and cheap to call after every render, after highlighting, and after the
 * body HTML is re-injected — it (1) refreshes the stored options, (2) restores
 * each block's persisted expanded/collapsed state, and (3) ensures exactly one
 * delegated click listener is attached to the container. Adding the same
 * function reference again is a DOM no-op, so wiring is fully idempotent without
 * any per-node bookkeeping.
 *
 * When `options.isExpanded` is supplied, persisted state is re-applied on every
 * call so a block stays expanded across re-renders that re-inject the body
 * (otherwise it would visibly flicker back to collapsed after an edit/refresh).
 */
export function wireCodeBlockToggles(
  element: HTMLElement,
  options: CodeToggleOptions = {},
): void {
  // Always store the latest callbacks for the delegated handler to read.
  containerOptions.set(element, options);

  // Index across all `.cb-code` wrappers (collapsible or not) so the index is a
  // stable key for the persisted-state callbacks regardless of block count.
  const wraps = element.querySelectorAll<HTMLElement>(".cb-code");
  wraps.forEach((wrap, index) => {
    const btn = wrap.querySelector<HTMLElement>(".cb-code__toggle");
    if (!btn) return; // non-collapsible block: nothing to restore

    // Strip any stale flag that leaked into stored HTML from older saves so it
    // never confuses other logic or re-serializes.
    if (btn.dataset.wired) delete btn.dataset.wired;

    // Restore persisted state on every (re)wire so it survives re-injection.
    if (options.isExpanded) applyToggleState(wrap, btn, options.isExpanded(index));
  });

  // Idempotent: re-adding the identical handler reference is ignored by the DOM.
  element.addEventListener("click", handleContainerClick);
}

export function getHljsModule() {
  return hljsModule;
}
