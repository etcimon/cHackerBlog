/**
 * Sticky-offset-aware anchor scrolling for the feed.
 *
 * The tag bar is `position: sticky`, so a plain scrollIntoView parks the
 * target underneath it. `html { scroll-padding-top }` (fed by
 * --cb-sticky-offset, published live by TagBar) makes the browser land
 * anchored elements below the bar instead.
 *
 * scrollToAnchor adds a short settle window on top: late layout shifts —
 * the feed's expand animation, images, embeds — can move the target after
 * the first scroll, so a ResizeObserver re-issues the scroll while the
 * target's document position keeps changing, without restarting the smooth
 * animation every frame when it hasn't moved.
 */

/** Height reserved at the top of the viewport by sticky chrome (html scroll-padding-top). */
export function stickyOffset(): number {
  const v = parseFloat(
    getComputedStyle(document.documentElement).scrollPaddingTop,
  );
  return Number.isFinite(v) ? v : 0;
}

const USER_INTENT_EVENTS = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

/**
 * Scroll element `id` to the top of the viewport and keep it there while late
 * layout shifts settle. Returns a cancel function.
 */
export function scrollToAnchor(
  id: string,
  opts: { behavior?: ScrollBehavior; settleMs?: number } = {},
): () => void {
  const found = document.getElementById(id);
  if (!found) return () => {};
  const el = found;

  const behavior: ScrollBehavior =
    opts.behavior ??
    (window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth");
  const settleMs = opts.settleMs ?? 2000;

  const scroll = () => el.scrollIntoView({ behavior, block: "start" });
  scroll();

  // Document position of the target; invariant under scrolling itself, so it
  // only changes when layout above it shifts.
  let lastDocTop = el.getBoundingClientRect().top + window.scrollY;
  let done = false;

  function onResize() {
    if (done) return;
    const docTop = el.getBoundingClientRect().top + window.scrollY;
    if (Math.abs(docTop - lastDocTop) >= 1) {
      lastDocTop = docTop;
      scroll();
    }
  }

  function teardown() {
    if (done) return;
    done = true;
    observer.disconnect();
    clearTimeout(timer);
    for (const type of USER_INTENT_EVENTS) {
      window.removeEventListener(type, onUserIntent);
    }
  }

  function onUserIntent() {
    teardown();
  }

  const observer = new ResizeObserver(onResize);
  observer.observe(document.body);

  const timer = setTimeout(teardown, settleMs);

  for (const type of USER_INTENT_EVENTS) {
    window.addEventListener(type, onUserIntent, { passive: true });
  }

  return teardown;
}
