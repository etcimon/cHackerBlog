/**
 * Shared highlight.js utilities for syntax highlighting.
 * Used by both wysiwyg editor and article card rendering.
 */

let hljsModule: any = null;
let hljsInitialized = false;
let cssLoaded = false;
let loadedLanguages = new Set<string>();

export async function initHighlightJs() {
  if (hljsInitialized) return;

  try {
    const module = await import("highlight.js");
    hljsModule = module.default || module;
    hljsInitialized = true;
  } catch (error) {
    console.error("Failed to initialize highlight.js:", error);
  }
}

export async function loadHighlightJsCss() {
  if (cssLoaded) return;

  if (typeof document !== "undefined") {
    const loadCss = (href: string) => {
      return new Promise<void>((resolve, reject) => {
        if (document.querySelector(`link[href="${href}"]`)) {
          resolve();
          return;
        }
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        link.onload = () => resolve();
        link.onerror = () => reject(new Error(`Failed to load ${href}`));
        document.head.appendChild(link);
      });
    };

    try {
      await Promise.all([
        loadCss("/api/highlightjs/styles/github-dark.css"),
        loadCss("/api/highlightjs/styles/github.css")
      ]);
      cssLoaded = true;
    } catch (error) {
      console.error("Failed to load highlight.js CSS:", error);
    }
  }
}

export async function loadHighlightJsLanguage(language: string): Promise<void> {
  if (loadedLanguages.has(language)) return;

  try {
    const langMap: Record<string, string> = {
      "js": "javascript",
      "ts": "typescript",
      "py": "python",
      "c++": "cpp",
      "c#": "csharp",
      "fs": "fsharp",
      "vb": "visualbasic",
      "sh": "bash",
      "yml": "yaml",
    };

    const hljsLang = langMap[language.toLowerCase()] || language.toLowerCase();
    // Import without .js extension as per highlight.js package exports
    await import(`highlight.js/lib/languages/${hljsLang}`);
    loadedLanguages.add(language);
  } catch (error) {
    console.warn(`Failed to load highlight.js language: ${language}`, error);
  }
}

export function hasCodeBlocks(html: string): boolean {
  return /<pre><code/.test(html);
}

export function extractLanguagesFromHtml(html: string): string[] {
  const regex = /class="language-(\w+)"/g;
  const languages = new Set<string>();
  let match;
  while ((match = regex.exec(html)) !== null) {
    languages.add(match[1]);
  }
  return Array.from(languages);
}

export async function ensureHighlightJsReady(html: string): Promise<void> {
  if (!hasCodeBlocks(html)) return;

  const languages = extractLanguagesFromHtml(html);
  await Promise.all([
    initHighlightJs(),
    loadHighlightJsCss(),
    ...languages.map(lang => loadHighlightJsLanguage(lang))
  ]);
}

export function highlightCodeInElement(element: HTMLElement): void {
  if (!hljsModule) return;

  const codeBlocks = element.querySelectorAll("pre code");
  codeBlocks.forEach((block) => {
    const classList = block.className;
    const langMatch = classList.match(/language-(\w+)/);
    const lang = langMatch ? langMatch[1] : "plaintext";

    if (hljsModule.getLanguage(lang)) {
      try {
        const text = block.textContent || "";
        const highlighted = hljsModule.highlight(text, { language: lang }).value;
        block.innerHTML = highlighted;

        // Use hljs-dark for hacker theme, hljs for others
        const theme = document.documentElement.getAttribute("data-theme");
        if (theme === "hacker") {
          block.classList.add("hljs-dark");
        } else {
          block.classList.add("hljs");
        }

        // Ensure language class comes first
        const classes = block.className.split(" ").filter(c => c !== "hljs" && c !== "hljs-dark");
        const hljsClass = theme === "hacker" ? "hljs-dark" : "hljs";
        block.className = classes.join(" ") + " " + hljsClass;
      } catch (error) {
        console.error("Failed to highlight code block:", error);
      }
    }
  });
}

export function getHljsModule() {
  return hljsModule;
}
