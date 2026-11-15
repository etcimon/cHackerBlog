"use client";

/**
 * Blinking terminal-style caret (hacker + medium themes). Rests at the end of
 * the title currently in view — the blog title or whichever article title the
 * reader has scrolled to — and follows the reader as they scroll. Clicking or
 * highlighting text moves it to that spot until another title scrolls into
 * view, which re-homes it.
 *
 * Active only for themes listed in CARET_VARIANTS; on every other theme the
 * effect bails out and nothing is rendered. Positions are stored in page
 * coordinates (viewport rect + scroll offset) so the caret stays anchored to
 * the text as the reader scrolls.
 */
import { useEffect, useState } from "react";

interface CaretPos {
  /** Left edge in page coordinates (the right edge of the last glyph). */
  left: number;
  /** Glyph-bottom in page coordinates (where the caret rests). */
  bottom: number;
  /** Computed font-size (px) of the anchored text; sizes the caret. */
  fontSize: number;
}

type CaretVariant = "underscore" | "crt";
const CARET_VARIANTS: Record<string, CaretVariant> = {
  hacker: "underscore",
  medium: "crt",
};

/** Where the caret is anchored: a title element or an exact text offset. */
type CaretAnchor =
  | { kind: "title"; el: HTMLElement }
  | { kind: "text"; node: Text; offset: number };

/** Cross-browser caret hit-test: returns the text node + offset under a point. */
function pointToTextPosition(
  x: number,
  y: number,
): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (typeof doc.caretPositionFromPoint === "function") {
    const p = doc.caretPositionFromPoint(x, y);
    return p ? { node: p.offsetNode, offset: p.offset } : null;
  }
  if (typeof doc.caretRangeFromPoint === "function") {
    const r = doc.caretRangeFromPoint(x, y);
    return r ? { node: r.startContainer, offset: r.startOffset } : null;
  }
  return null;
}

/** Computed font-size (px) of the element that owns a node. */
function fontSizeOf(node: Node): number {
  const el =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement;
  if (!el) return 16;
  return parseFloat(getComputedStyle(el).fontSize) || 16;
}

/**
 * Build a caret position from a glyph rect. The x sits at the glyph's right
 * edge; the caret aligns to the glyph bottom. Because the line box
 * (rect.height) is taller than the font when line-height > 1, we derive the
 * glyph bottom from the font-size so the caret hugs the text — not the line box.
 */
function posFromGlyphRect(r: DOMRect, fontSize: number): CaretPos | null {
  if (r.height === 0 && r.width === 0) return null;
  const glyphBottom = r.top + (r.height + fontSize) / 2;
  return {
    left: r.right + window.scrollX,
    bottom: glyphBottom + window.scrollY,
    fontSize,
  };
}

/**
 * Compute the caret position sitting at `offset` within a text node. Measures
 * the right edge of the preceding glyph (robust at word/line ends where a
 * collapsed range often reports an empty rect).
 */
function rectForTextOffset(node: Text, offset: number): CaretPos | null {
  const fontSize = fontSizeOf(node);
  const range = document.createRange();
  if (offset > 0) {
    range.setStart(node, offset - 1);
    range.setEnd(node, offset);
    const rects = range.getClientRects();
    const r = rects[rects.length - 1];
    if (r && (r.width > 0 || r.height > 0))
      return posFromGlyphRect(r as DOMRect, fontSize);
  }
  range.setStart(node, offset);
  range.collapse(true);
  return posFromGlyphRect(range.getBoundingClientRect(), fontSize);
}

/** Last text node + its last non-whitespace offset within an element. */
function lastWordEnd(el: HTMLElement): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let last: Text | null = null;
  while (walker.nextNode()) {
    const t = walker.currentNode as Text;
    if ((t.textContent ?? "").trim().length > 0) last = t;
  }
  if (!last) return null;
  const text = last.textContent ?? "";
  let end = text.length;
  while (end > 0 && /\s/.test(text[end - 1]!)) end--;
  return { node: last, offset: end };
}

export function TerminalCaret() {
  const [pos, setPos] = useState<CaretPos | null>(null);
  const [variant, setVariant] = useState<CaretVariant | null>(null);

  useEffect(() => {
    const v = CARET_VARIANTS[document.documentElement.dataset.theme ?? ""];
    if (!v) return;
    setVariant(v);

    let anchor: CaretAnchor | null = null;
    let lastFocusedTitle: HTMLElement | null = null;
    let current: CaretPos | null = null;
    let scheduled = false;

    // First title candidate whose last glyph is fully inside the viewport and
    // actually hit-testable there (not covered by the sticky tag bar etc.).
    const focusedTitle = (): HTMLElement | null => {
      const candidates = document.querySelectorAll<HTMLElement>(
        "[data-caret-home], [data-caret-title]",
      );
      for (const el of Array.from(candidates)) {
        const end = lastWordEnd(el);
        if (!end || end.offset === 0) continue;
        const range = document.createRange();
        range.setStart(end.node, end.offset - 1);
        range.setEnd(end.node, end.offset);
        const rects = range.getClientRects();
        const r = rects[rects.length - 1] as DOMRect | undefined;
        if (!r || r.width === 0) continue;
        if (r.top < 0 || r.bottom > window.innerHeight) continue;
        const hit = document.elementFromPoint(
          (r.left + r.right) / 2,
          (r.top + r.bottom) / 2,
        );
        if (hit && (hit === el || el.contains(hit))) return el;
      }
      return null;
    };

    const posFromAnchor = (): CaretPos | null => {
      if (anchor) {
        if (anchor.kind === "title") {
          if (anchor.el.isConnected) {
            const end = lastWordEnd(anchor.el);
            if (end) {
              const p = rectForTextOffset(end.node, end.offset);
              if (p) return p;
            }
          }
        } else if (anchor.node.isConnected) {
          const p = rectForTextOffset(anchor.node, anchor.offset);
          if (p) return p;
        }
      }
      // Stale/disconnected click anchor: fall back to the last focused title.
      if (lastFocusedTitle?.isConnected) {
        const end = lastWordEnd(lastFocusedTitle);
        if (end) {
          const p = rectForTextOffset(end.node, end.offset);
          if (p) return p;
        }
      }
      return null;
    };

    const commit = (next: CaretPos | null) => {
      if (
        next &&
        current &&
        next.left === current.left &&
        next.bottom === current.bottom &&
        next.fontSize === current.fontSize
      ) {
        return;
      }
      current = next;
      setPos(next);
    };

    const update = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        // A newly focused title re-homes the caret; while the same title
        // stays focused a click/selection placement sticks.
        const t = focusedTitle();
        if (t && t !== lastFocusedTitle) {
          lastFocusedTitle = t;
          anchor = { kind: "title", el: t };
        }
        commit(posFromAnchor());
      });
    };

    const isInteractive = (el: EventTarget | null) =>
      el instanceof Element &&
      el.closest("input, textarea, select, button, [contenteditable='true']");

    const onMouseUp = (e: MouseEvent) => {
      if (isInteractive(e.target)) return;
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
        const range = sel.getRangeAt(0);
        if (range.endContainer.nodeType === Node.TEXT_NODE) {
          anchor = {
            kind: "text",
            node: range.endContainer as Text,
            offset: range.endOffset,
          };
          update();
          return;
        }
        // Element endpoint: position directly, keep the current anchor.
        const next = posFromGlyphRect(
          range.getBoundingClientRect(),
          fontSizeOf(range.endContainer),
        );
        if (next) commit(next);
        return;
      }
      const cp = pointToTextPosition(e.clientX, e.clientY);
      if (!cp || cp.node.nodeType !== Node.TEXT_NODE) return;
      const text = cp.node.textContent ?? "";
      let end = cp.offset;
      while (end < text.length && /\S/.test(text[end]!)) end++;
      anchor = { kind: "text", node: cp.node as Text, offset: end };
      update();
    };

    const timers: ReturnType<typeof setTimeout>[] = [];
    [60, 600].forEach((ms) => timers.push(setTimeout(update, ms)));

    const observer = new ResizeObserver(update);
    observer.observe(document.body);

    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      timers.forEach(clearTimeout);
      observer.disconnect();
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  if (!pos || !variant) return null;

  // Page coordinates -> inline style. `underscore` is the hacker-theme bar;
  // `crt` is a small phosphor pixel block whose --caret-cell drives the CSS
  // grid texture in themes/_themes.scss.
  let style: React.CSSProperties;
  if (variant === "crt") {
    const cell = Math.max(2, Math.round(pos.fontSize * 0.09));
    style = {
      left: pos.left + cell,
      top: pos.bottom - 2 * cell,
      width: 5 * cell,
      height: 2 * cell,
      "--caret-cell": `${cell}px`,
    } as React.CSSProperties;
  } else {
    const thickness = Math.max(1, Math.round(pos.fontSize * 0.08));
    const width = Math.max(6, Math.round(pos.fontSize * 0.5));
    const gap = Math.round(pos.fontSize * 0.08);
    style = {
      left: pos.left + gap,
      top: pos.bottom - thickness,
      width,
      height: thickness,
    };
  }

  return (
    <span
      aria-hidden="true"
      className={`terminal-caret terminal-caret--${variant}`}
      style={style}
    />
  );
}
