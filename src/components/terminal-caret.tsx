"use client";

/**
 * Blinking terminal-style caret for the hacker theme. Renders a glowing,
 * underscore-shaped caret that, by default, rests at the end of the blog title
 * — or, when an article link (/article/<slug>) is loaded, at the end of that
 * article's title. From there it jumps to sit just after whichever word the
 * reader clicks, or after the end of any text they highlight, giving the page
 * an old-terminal feel.
 *
 * Active only when <html data-theme="hacker">; on every other theme the effect
 * bails out and nothing is rendered. Positions are stored in page coordinates
 * (viewport rect + scroll offset) so the caret stays anchored to the text as the
 * reader scrolls.
 */
import { useEffect, useRef, useState } from "react";

interface CaretPos {
  /** Left edge in page coordinates (the right edge of the last glyph). */
  left: number;
  /** Glyph-bottom in page coordinates (where the underscore rests). */
  bottom: number;
  /** Computed font-size (px) of the anchored text; sizes the caret. */
  fontSize: number;
}

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
 * edge; the underscore aligns to the glyph bottom. Because the line box
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
  // Once the reader has clicked/selected, stop auto-snapping back to the title.
  const userMovedRef = useRef(false);

  useEffect(() => {
    if (document.documentElement.dataset.theme !== "hacker") return;

    const placeAtTextOffset = (node: Node, offset: number): boolean => {
      if (node.nodeType !== Node.TEXT_NODE) return false;
      const next = rectForTextOffset(node as Text, offset);
      if (next) {
        setPos(next);
        return true;
      }
      return false;
    };

    // Snap to the end of the word the reader clicked.
    const placeAtWordEnd = (node: Node, offset: number) => {
      if (node.nodeType !== Node.TEXT_NODE) return;
      const text = node.textContent ?? "";
      let end = offset;
      while (end < text.length && /\S/.test(text[end]!)) end++;
      placeAtTextOffset(node, end);
    };

    // Snap to the end of a (non-collapsed) highlight/selection.
    const placeAtRangeEnd = (range: Range) => {
      if (placeAtTextOffset(range.endContainer, range.endOffset)) return;
      const next = posFromGlyphRect(
        range.getBoundingClientRect(),
        fontSizeOf(range.endContainer),
      );
      if (next) setPos(next);
    };

    // Resolve the default anchor: the loaded article's title on /article/<slug>,
    // otherwise the blog title (falls back to the first <h1>).
    const findDefaultAnchor = (): HTMLElement | null => {
      const m = window.location.pathname.match(/^\/article\/(.+?)\/?$/);
      if (m) {
        const slug = decodeURIComponent(m[1]!);
        const header = document.getElementById(`${slug}-header`);
        const h2 = header?.querySelector("h2");
        if (h2) return h2 as HTMLElement;
      }
      return (
        document.querySelector<HTMLElement>("[data-caret-home]") ??
        document.querySelector<HTMLElement>("h1")
      );
    };

    const placeAtDefaultAnchor = (): boolean => {
      const anchor = findDefaultAnchor();
      if (!anchor) return false;
      const end = lastWordEnd(anchor);
      if (!end) return false;
      const next = rectForTextOffset(end.node, end.offset);
      if (next) {
        setPos(next);
        return true;
      }
      return false;
    };

    const isInteractive = (el: EventTarget | null) =>
      el instanceof Element &&
      el.closest("input, textarea, select, button, [contenteditable='true']");

    const onMouseUp = (e: MouseEvent) => {
      if (isInteractive(e.target)) return;
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
        placeAtRangeEnd(sel.getRangeAt(0));
        userMovedRef.current = true;
        return;
      }
      const cp = pointToTextPosition(e.clientX, e.clientY);
      if (!cp) return;
      placeAtWordEnd(cp.node, cp.offset);
      userMovedRef.current = true;
    };

    const onResize = () => {
      if (!userMovedRef.current) placeAtDefaultAnchor();
    };

    // The article title is rendered by the client <Feed> after hydration, so
    // retry a few times until the anchor exists (stop once the reader moves it).
    const timers: ReturnType<typeof setTimeout>[] = [];
    [60, 250, 600, 1000].forEach((ms) => {
      timers.push(
        setTimeout(() => {
          if (!userMovedRef.current) placeAtDefaultAnchor();
        }, ms),
      );
    });

    document.addEventListener("mouseup", onMouseUp);
    window.addEventListener("resize", onResize);
    return () => {
      timers.forEach(clearTimeout);
      document.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  if (!pos) return null;

  // Underscore caret: a short horizontal bar resting on the text baseline,
  // proportional to the font-size of whatever text it's anchored to.
  const thickness = Math.max(1, Math.round(pos.fontSize * 0.08));
  const width = Math.max(6, Math.round(pos.fontSize * 0.5));
  const gap = Math.round(pos.fontSize * 0.08);
  return (
    <span
      aria-hidden="true"
      className="terminal-caret"
      style={{
        left: pos.left + gap,
        top: pos.bottom - thickness,
        width,
        height: thickness,
      }}
    />
  );
}
