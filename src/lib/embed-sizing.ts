/**
 * Read/re-render size-capable elements inside the WYSIWYG rich surface for the
 * "size" toolbar item: sized images, file embeds, URL embeds and code blocks.
 * Everything here is pure DOM inspection plus string building — the editor
 * owns the actual replaceWith/onChange side effects. Selection state itself is
 * never written into the DOM (the editor serializes innerHTML on save).
 */
import {
  buildEmbedHtml,
  buildImageHtml,
  buildUrlEmbedHtml,
  parseSizeSpec,
  type EmbedSize,
} from "@/lib/embeds";
import { buildCodeBlock, escapeCode } from "@/lib/code-block-render";

export type SizableTarget =
  | { kind: "image"; alt: string; src: string; size: EmbedSize }
  | { kind: "file"; name: string; src: string; size: EmbedSize }
  | {
      kind: "url";
      url: string;
      size: EmbedSize;
      urlOnly: boolean;
    }
  | {
      kind: "code";
      lang: string;
      bodyHtml: string;
      highlighted: boolean;
      totalLines: number;
      size: EmbedSize;
      previewLines?: number;
      collapseKind: "preview" | "collapse";
    };

/**
 * Nearest size-capable element for `node` inside `root`, or null. Precedence:
 * `[data-embed="1"]` -> `.cb-code` -> `pre` -> `img`, so e.g. a thumbnail
 * <img> inside a link card resolves to the card.
 */
export function findSizableElement(
  node: Node | null,
  root: HTMLElement,
): HTMLElement | null {
  if (!node) return null;
  const el =
    node.nodeType === 1
      ? (node as HTMLElement)
      : (node as ChildNode).parentElement;
  if (!el || el === root || !root.contains(el)) return null;
  for (const selector of ['[data-embed="1"]', ".cb-code", "pre", "img"]) {
    const hit = el.closest(selector);
    if (hit && hit !== root && root.contains(hit)) {
      return hit as HTMLElement;
    }
  }
  return null;
}

/**
 * Node the current selection designates: a singly-selected element when the
 * range wraps exactly one element child, else the range start container.
 */
export function selectionNode(sel: Selection | null): Node | null {
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (
    !range.collapsed &&
    range.startContainer === range.endContainer &&
    range.endOffset - range.startOffset === 1
  ) {
    const child = range.startContainer.childNodes[range.startOffset];
    if (child && child.nodeType === 1) return child;
  }
  return range.startContainer;
}

/** Line count of code text with one trailing newline stripped. */
function countLines(text: string): number {
  const stripped = text.endsWith("\n") ? text.slice(0, -1) : text;
  return stripped.split("\n").length;
}

function langOf(code: Element | null | undefined): string {
  const m = code?.className.match(/language-([\w+#-]+)/);
  return m ? m[1] : "plaintext";
}

/** Read an element's current size-related properties. */
export function readSizable(el: HTMLElement): SizableTarget | null {
  const embed = el.closest('[data-embed="1"]');
  if (embed) {
    const size = parseSizeSpec(embed.getAttribute("data-size") || "");
    if (embed.getAttribute("data-embed-type") === "url") {
      return {
        kind: "url",
        url: embed.getAttribute("data-src") || "",
        size,
        urlOnly: embed.getAttribute("data-url-only") === "1",
      };
    }
    return {
      kind: "file",
      name: embed.getAttribute("data-name") || "",
      src: embed.getAttribute("data-src") || "",
      size,
    };
  }

  const codeWrap = el.closest(".cb-code");
  if (codeWrap) {
    const code = codeWrap.querySelector("pre > code");
    const text = code?.textContent ?? "";
    const dataLines = Number(codeWrap.getAttribute("data-lines"));
    const totalLines =
      Number.isFinite(dataLines) && dataLines > 0
        ? dataLines
        : countLines(text);
    const previewAttr = codeWrap.getAttribute("data-preview-lines");
    const previewLines = previewAttr ? Number(previewAttr) : NaN;
    const collapseAttr = codeWrap.getAttribute("data-collapse-kind");
    return {
      kind: "code",
      lang: langOf(code),
      bodyHtml: code?.innerHTML ?? "",
      highlighted: !!code && code.classList.contains("hljs"),
      totalLines,
      size: parseSizeSpec(codeWrap.getAttribute("data-size") || ""),
      previewLines: Number.isFinite(previewLines) ? previewLines : undefined,
      collapseKind: collapseAttr === "collapse" ? "collapse" : "preview",
    };
  }

  const pre = el.closest("pre");
  if (pre) {
    const text = (pre.textContent || "").replace(/\n$/, "");
    return {
      kind: "code",
      lang: langOf(pre.querySelector("code")),
      bodyHtml: escapeCode(text),
      highlighted: false,
      totalLines: countLines(text),
      size: { type: "none" },
      collapseKind: "preview",
    };
  }

  if (el instanceof HTMLImageElement || el.tagName === "IMG") {
    const img = el as HTMLImageElement;
    return {
      kind: "image",
      alt: img.getAttribute("data-alt") ?? img.getAttribute("alt") ?? "",
      src: img.getAttribute("data-src") ?? img.getAttribute("src") ?? "",
      size: parseSizeSpec(img.getAttribute("data-size") || ""),
    };
  }

  return null;
}

/** Re-render a target with (possibly changed) properties. Pure — no DOM. */
export function renderSizable(t: SizableTarget): string {
  switch (t.kind) {
    case "image":
      return buildImageHtml({ alt: t.alt, src: t.src, size: t.size });
    case "file":
      return buildEmbedHtml({ name: t.name, src: t.src, size: t.size });
    case "url":
      return buildUrlEmbedHtml({ url: t.url, size: t.size, urlOnly: t.urlOnly });
    case "code":
      return buildCodeBlock(
        t.bodyHtml,
        t.lang,
        t.totalLines,
        {
          previewLines: t.previewLines,
          collapseKind: t.collapseKind,
          size: t.size,
        },
        t.highlighted,
      );
  }
}
