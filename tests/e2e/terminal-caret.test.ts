/**
 * E2E: the terminal caret rests at the end of the title currently in view.
 *
 * On the hacker theme it renders the underscore variant and must follow the
 * reader: blog title first, then whichever article title is scrolled into
 * view — while a click/selection placement sticks until another title takes
 * focus. A second test flips data-theme to "medium" before page scripts run
 * and asserts the CRT pixel variant (grid texture, --caret-cell sizing,
 * phosphor-green colour).
 *
 * Runs against the test server started by tests/e2e/setup.ts (port 3001,
 * test.sqlite, THEME=hacker). See tests/README.md.
 */
import { setup, teardown } from "./setup";
import { PrismaClient } from "../../src/generated/prisma/client/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

const adapter = new PrismaLibSql({ url: "file:./test.sqlite" });
const prisma = new PrismaClient({ adapter });

/** ~150-char paragraph of article body HTML. */
function paragraph(slug: string, i: number): string {
  const filler = "lorem ipsum dolor sit amet, consectetur adipiscing elit. ";
  const text = `Paragraph ${i + 1} of ${slug}. ${filler.repeat(3)}`.slice(
    0,
    150,
  );
  return `<p>${text}</p>`;
}

async function seedCaretArticles(): Promise<void> {
  // Push the default articles far into the past so the caret articles own
  // the top of the feed in publishedAt-desc order (a1 newest .. a4 oldest).
  await prisma.article.updateMany({
    where: {
      slug: { in: ["test-article-1", "test-article-2", "test-article-3"] },
    },
    data: { publishedAt: new Date("2020-01-01") },
  });

  for (let n = 1; n <= 4; n++) {
    const slug = `caret-a${n}`;
    await prisma.article.create({
      data: {
        slug,
        title: `Caret Article A${n}`,
        content: Array.from({ length: 40 }, (_, i) => paragraph(slug, i)).join(
          "",
        ),
        published: true,
        publishedAt: new Date(Date.now() - n * 60_000),
        locale: "en",
      },
    });
  }
}

interface CaretState {
  caret: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  } | null;
  className: string;
  zIndex: string;
  backgroundColor: string;
  backgroundImage: string;
  caretCell: string;
  title: { top: number; bottom: number; fontSize: number } | null;
  glyphRight: number | null;
}

/** Snapshot the caret element plus the target title's last-glyph metrics. */
async function caretState(page: any, titleSelector: string): Promise<CaretState> {
  return page.evaluate((sel: string) => {
    const caret = document.querySelector(".terminal-caret");
    const cr = caret?.getBoundingClientRect();
    const title = document.querySelector(sel);
    let glyphRight: number | null = null;
    let fontSize = 0;
    if (title) {
      const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
      let last: Text | null = null;
      while (walker.nextNode()) {
        const t = walker.currentNode as Text;
        if ((t.textContent ?? "").trim().length > 0) last = t;
      }
      if (last) {
        const text = last.textContent ?? "";
        let end = text.length;
        while (end > 0 && /\s/.test(text[end - 1]!)) end--;
        fontSize = parseFloat(getComputedStyle(title).fontSize) || 16;
        if (end > 0) {
          const range = document.createRange();
          range.setStart(last, end - 1);
          range.setEnd(last, end);
          const rects = range.getClientRects();
          const r = rects[rects.length - 1] as DOMRect | undefined;
          if (r) glyphRight = r.right;
        }
      }
    }
    const cs = caret ? getComputedStyle(caret) : null;
    const tr = title?.getBoundingClientRect();
    return {
      caret: cr
        ? {
            left: cr.left,
            top: cr.top,
            right: cr.right,
            bottom: cr.bottom,
            width: cr.width,
            height: cr.height,
          }
        : null,
      className: caret?.className ?? "",
      zIndex: cs?.zIndex ?? "",
      backgroundColor: cs?.backgroundColor ?? "",
      backgroundImage: cs?.backgroundImage ?? "",
      caretCell:
        caret instanceof HTMLElement
          ? getComputedStyle(caret).getPropertyValue("--caret-cell").trim()
          : "",
      title: tr ? { top: tr.top, bottom: tr.bottom, fontSize } : null,
      glyphRight,
    };
  }, titleSelector);
}

function expectCaretAtTitle(s: CaretState): void {
  expect(s.caret).not.toBeNull();
  expect(s.title).not.toBeNull();
  expect(s.glyphRight).not.toBeNull();
  const gap = s.caret!.left - s.glyphRight!;
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThanOrEqual(0.4 * s.title!.fontSize);
  const cy = (s.caret!.top + s.caret!.bottom) / 2;
  expect(cy).toBeGreaterThanOrEqual(s.title!.top);
  expect(cy).toBeLessThanOrEqual(s.title!.bottom + 2);
}

/** Pause the blink and screenshot ~400x120 px around the caret. */
async function shotCaret(page: any, path: string): Promise<void> {
  const rect = await page.evaluate(() => {
    const el = document.querySelector(".terminal-caret");
    if (!el) return null;
    (el as HTMLElement).style.animation = "none";
    const r = el.getBoundingClientRect();
    return {
      x: Math.max(0, r.left + r.width / 2 - 200),
      y: Math.max(0, r.top + r.height / 2 - 60),
      width: 400,
      height: 120,
    };
  });
  if (!rect) throw new Error("caret not found for screenshot");
  await page.screenshot({ path, clip: rect });
}

describe("Terminal caret follows the title in view", () => {
  let context: Awaited<ReturnType<typeof setup>>;

  beforeAll(async () => {
    context = await setup(seedCaretArticles);
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
    await teardown(context);
  }, 10_000);

  it("rests at the blog title, then follows the title in view (hacker)", async () => {
    const { page, baseUrl } = context;
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`${baseUrl}/`, {
      waitUntil: "networkidle0",
      timeout: 60_000,
    });
    await page.waitForSelector(".terminal-caret", { timeout: 15_000 });
    await new Promise((r) => setTimeout(r, 800));

    // 1. Blog title.
    let s = await caretState(page, "[data-caret-home]");
    console.log("home:", JSON.stringify(s));
    expectCaretAtTitle(s);
    expect(s.className).toContain("terminal-caret--underscore");
    expect(s.zIndex).toBe("30");
    await shotCaret(page, "tmp/baseline/caret-hacker.png");

    // 2. Scroll caret-a2's top anchor into view -> its h2 takes focus.
    await page.evaluate(() =>
      document.getElementById("caret-a2-top")?.scrollIntoView(),
    );
    await new Promise((r) => setTimeout(r, 800));
    s = await caretState(page, "#caret-a2-header h2");
    console.log("a2 title:", JSON.stringify(s));
    expectCaretAtTitle(s);

    // 3. Click a visible paragraph inside caret-a2 -> caret moves off-title.
    const para = await page.evaluate(() => {
      const ps = Array.from(
        document.querySelectorAll("#caret-a2 p"),
      ) as HTMLElement[];
      const p = ps.find((el) => {
        const r = el.getBoundingClientRect();
        return r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight;
      });
      if (!p) return null;
      const r = p.getBoundingClientRect();
      return {
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        top: r.top,
        bottom: r.bottom,
      };
    });
    expect(para).not.toBeNull();
    await page.mouse.click(para!.x, para!.y);
    await new Promise((r) => setTimeout(r, 300));
    const afterClick = await page.evaluate(() => {
      const caret = document.querySelector(".terminal-caret");
      const cr = caret?.getBoundingClientRect();
      return cr
        ? { cy: (cr.top + cr.bottom) / 2, top: cr.top, bottom: cr.bottom }
        : null;
    });
    console.log("after click:", JSON.stringify(afterClick), "para:", JSON.stringify({ top: para!.top, bottom: para!.bottom }));
    expect(afterClick).not.toBeNull();
    expect(afterClick!.cy).toBeGreaterThan(para!.top);
    expect(afterClick!.cy).toBeLessThan(para!.bottom);

    // 4. Scroll caret-a3's top anchor into view -> newly focused title
    //    re-homes the caret.
    await page.evaluate(() =>
      document.getElementById("caret-a3-top")?.scrollIntoView(),
    );
    await new Promise((r) => setTimeout(r, 800));
    s = await caretState(page, "#caret-a3-header h2");
    console.log("a3 title:", JSON.stringify(s));
    expectCaretAtTitle(s);
  }, 90_000);

  it("uses the CRT pixel look on the medium theme", async () => {
    const { baseUrl } = context;
    const page = await context.browser.newPage();
    try {
      await page.setViewport({
        width: 1280,
        height: 900,
        deviceScaleFactor: 3,
      });
      // Flip to the medium theme before any page script runs; all themes'
      // CSS ships in one stylesheet so the real medium rules apply.
      await page.evaluateOnNewDocument(() => {
        const flip = () => {
          const el = document.documentElement;
          if (el && el.dataset.theme === "hacker") {
            el.dataset.theme = "medium";
          }
        };
        flip();
        new MutationObserver(flip).observe(document, {
          childList: true,
          subtree: true,
          attributes: true,
        });
      });
      await page.goto(`${baseUrl}/`, {
        waitUntil: "networkidle0",
        timeout: 60_000,
      });
      await page.waitForSelector(".terminal-caret", { timeout: 15_000 });
      await new Promise((r) => setTimeout(r, 800));

      const s = await caretState(page, "[data-caret-home]");
      console.log("medium home:", JSON.stringify(s));
      expect(s.className).toContain("terminal-caret--crt");
      expect(s.backgroundColor).toBe("rgb(30, 215, 96)");
      expect(s.backgroundImage).toContain("linear-gradient");
      const cell = parseInt(s.caretCell, 10);
      expect(Number.isInteger(cell)).toBe(true);
      expect(cell).toBeGreaterThanOrEqual(2);
      expect(Math.round(s.caret!.width)).toBe(5 * cell);
      expect(Math.round(s.caret!.height)).toBe(2 * cell);
      expectCaretAtTitle(s);
      await shotCaret(page, "tmp/baseline/caret-medium.png");
    } finally {
      await page.close();
    }
  }, 90_000);
});
