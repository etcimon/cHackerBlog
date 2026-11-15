/**
 * E2E: article scroll alignment under the sticky tag bar.
 *
 * Reproduces the reported bug where /article/<slug> auto-scrolls to the
 * article but lands with the title hidden behind the sticky tag bar: the
 * scroll targets the zero-height `#<slug>-top` anchor at viewport y=0 while
 * the bar (taller when tags wrap) overlays the top of the viewport.
 *
 * The test seeds six tag-scoped articles (scroll-a1..a6) plus filler tags so
 * the bar wraps on narrow viewports, then measures the live geometry of the
 * tag bar, the `-top` anchor, the card header and the title h2 after the
 * page settles, and asserts the whole title block clears the bar.
 *
 * Runs against the test server started by tests/e2e/setup.ts (port 3001,
 * test.sqlite). See tests/README.md.
 */
import { setup, teardown } from "./setup";
import { PrismaClient } from "../../src/generated/prisma/client/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

const adapter = new PrismaLibSql({ url: "file:./test.sqlite" });
const prisma = new PrismaClient({ adapter });

/** ~150-char paragraph of article body HTML. */
function paragraph(slug: string, i: number): string {
  const filler = "lorem ipsum dolor sit amet, consectetur adipiscing elit. ";
  const text = `Paragraph ${i + 1} of ${slug}. ${filler.repeat(3)}`.slice(0, 150);
  return `<p>${text}</p>`;
}

function articleContent(slug: string, count: number): string {
  return Array.from({ length: count }, (_, i) => paragraph(slug, i)).join("");
}

async function seedScrollArticles(): Promise<void> {
  // Push the default articles far into the past so the scroll articles own
  // the top of the feed in publishedAt-desc order (a1 newest .. a6 oldest).
  await prisma.article.updateMany({
    where: { slug: { in: ["test-article-1", "test-article-2", "test-article-3"] } },
    data: { publishedAt: new Date("2020-01-01") },
  });

  await prisma.tag.upsert({
    where: { slug: "scrolltest" },
    update: {},
    create: { name: "scrolltest", slug: "scrolltest" },
  });

  // Filler tags with no articles: enough pills to wrap the bar on mobile.
  for (let i = 1; i <= 14; i++) {
    const slug = `filler-tag-${String(i).padStart(2, "0")}`;
    await prisma.tag.upsert({
      where: { slug },
      update: {},
      create: { name: slug, slug },
    });
  }

  for (let n = 1; n <= 6; n++) {
    const slug = `scroll-a${n}`;
    await prisma.article.create({
      data: {
        slug,
        title: `Scroll Target A${n}`,
        content: articleContent(slug, n === 2 ? 400 : 40),
        published: true,
        publishedAt: new Date(Date.now() - n * 60_000),
        locale: "en",
        tags: { connect: { slug: "scrolltest" } },
      },
    });
  }
}

/** Wait >=2.5s, then until window.scrollY is unchanged for 1s (cap 15s). */
async function settle(page: any): Promise<void> {
  await new Promise((r) => setTimeout(r, 2500));
  const start = Date.now();
  let last = Number.NaN;
  let stableSince = Date.now();
  while (Date.now() - start < 15_000) {
    const y = await page.evaluate(() => window.scrollY);
    if (y === last) {
      if (Date.now() - stableSince >= 1000) return;
    } else {
      last = y;
      stableSince = Date.now();
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

interface Measure {
  navBottom: number | null;
  anchorTop: number | null;
  headerTop: number | null;
  titleTop: number | null;
  titleBottom: number | null;
  viewportH: number;
  scrollY: number;
}

async function measure(page: any, slug: string): Promise<Measure> {
  return page.evaluate((s: string) => {
    const nav = document.querySelector('[data-testid="tag-bar"]');
    const anchor = document.getElementById(`${s}-top`);
    const header = document.getElementById(`${s}-header`);
    const title = document.querySelector(`#${s}-header h2`);
    const top = (el: Element | null) => el?.getBoundingClientRect().top ?? null;
    const bottom = (el: Element | null) => el?.getBoundingClientRect().bottom ?? null;
    return {
      navBottom: bottom(nav),
      anchorTop: top(anchor),
      headerTop: top(header),
      titleTop: top(title),
      titleBottom: bottom(title),
      viewportH: window.innerHeight,
      scrollY: window.scrollY,
    };
  }, slug);
}

function expectAligned(m: Measure): void {
  expect(m.navBottom).not.toBeNull();
  expect(m.anchorTop).not.toBeNull();
  expect(m.headerTop).not.toBeNull();
  expect(m.titleTop).not.toBeNull();
  expect(m.titleBottom).not.toBeNull();
  // The card header and the title must clear the bottom of the sticky bar.
  expect(m.headerTop!).toBeGreaterThanOrEqual(m.navBottom! - 1);
  expect(m.titleTop!).toBeGreaterThanOrEqual(m.navBottom! - 1);
  expect(m.titleBottom!).toBeLessThanOrEqual(m.viewportH);
  // The zero-height anchor should land flush with the bar's bottom edge.
  expect(Math.abs(m.anchorTop! - m.navBottom!)).toBeLessThanOrEqual(3);
}

interface NextButtonProbe {
  btn: { x: number; y: number; w: number; h: number };
  bubble: { x: number; y: number; w: number; h: number } | null;
  hit: string;
  covered: boolean;
}

/** Geometry + hit-test of .feed-next-btn vs the fixed live-chat bubble. */
async function probeNextButton(page: any): Promise<NextButtonProbe | null> {
  return page.evaluate(() => {
    const btn = document.querySelector(".feed-next-btn");
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    const hit = document.elementFromPoint(
      r.left + r.width / 2,
      r.top + r.height / 2,
    );
    const bubble = document.querySelector(
      ".fixed.bottom-3.right-3 button[aria-label]",
    );
    const br = bubble?.getBoundingClientRect();
    const rect = (b: DOMRect) => ({ x: b.x, y: b.y, w: b.width, h: b.height });
    return {
      btn: rect(r),
      bubble: br ? rect(br) : null,
      hit: hit
        ? `${hit.tagName}.${(hit.getAttribute("class") ?? "").slice(0, 80)}`
        : "none",
      covered: !(hit && (hit === btn || btn.contains(hit))),
    };
  });
}

describe("Article scroll alignment under the sticky tag bar", () => {
  let context: Awaited<ReturnType<typeof setup>>;

  beforeAll(async () => {
    context = await setup(seedScrollArticles);
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
    await teardown(context);
  }, 10_000);

  it("article route lands with the full title below the sticky tag bar (desktop)", async () => {
    const { page, baseUrl } = context;
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`${baseUrl}/article/scroll-a4`, {
      waitUntil: "networkidle0",
      timeout: 60_000,
    });
    await page.waitForSelector("#scroll-a4-top");
    await settle(page);
    const m = await measure(page, "scroll-a4");
    console.log("desktop /article/scroll-a4:", JSON.stringify(m));
    expectAligned(m);
  }, 90_000);

  it("article route lands with the full title below the sticky tag bar when the bar wraps (mobile)", async () => {
    const { page, baseUrl } = context;
    await page.setViewport({ width: 390, height: 844 });
    await page.goto(`${baseUrl}/article/scroll-a4`, {
      waitUntil: "networkidle0",
      timeout: 60_000,
    });
    await page.waitForSelector("#scroll-a4-top");
    await settle(page);
    const m = await measure(page, "scroll-a4");
    console.log("mobile /article/scroll-a4:", JSON.stringify(m));
    // Precondition: the bar really did wrap to several rows.
    expect(m.navBottom).toBeGreaterThan(60);
    expectAligned(m);
  }, 90_000);

  it("next-post button steps through articles by position", async () => {
    const { page, baseUrl } = context;
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle0", timeout: 60_000 });
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="article-card"]').length >= 2,
      { timeout: 30_000 },
    );
    const slugs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="article-card"]')).map(
        (a) => a.id,
      ),
    );
    await page.waitForSelector(".feed-next-btn", { timeout: 10_000 });
    const probe = await probeNextButton(page);
    console.log("desktop next-btn probe:", JSON.stringify(probe));
    expect(probe).not.toBeNull();
    expect(probe!.covered).toBe(false);

    await page.click(".feed-next-btn");
    await settle(page);
    const m1 = await measure(page, slugs[1]);
    console.log("next-post click 1 ->", slugs[1], JSON.stringify(m1));
    expectAligned(m1);

    await page.click(".feed-next-btn");
    await settle(page);
    const m2 = await measure(page, slugs[2]);
    console.log("next-post click 2 ->", slugs[2], JSON.stringify(m2));
    expectAligned(m2);

    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise((r) => setTimeout(r, 500));
    await page.click(".feed-next-btn");
    await settle(page);
    const m3 = await measure(page, slugs[1]);
    console.log("next-post after scrollTo(0,0) ->", slugs[1], JSON.stringify(m3));
    expectAligned(m3);
  }, 90_000);

  it("next-post button is not covered by the chat bubble on mobile", async () => {
    const { page, baseUrl } = context;
    await page.setViewport({ width: 390, height: 844 });
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle0", timeout: 60_000 });
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="article-card"]').length >= 2,
      { timeout: 30_000 },
    );
    await page.waitForSelector(".feed-next-btn", { timeout: 10_000 });
    const probe = await probeNextButton(page);
    console.log("mobile next-btn probe:", JSON.stringify(probe));
    expect(probe).not.toBeNull();
    expect(probe!.covered).toBe(false);
  }, 90_000);
});
