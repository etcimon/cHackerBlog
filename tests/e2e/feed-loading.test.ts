/**
 * E2E: feed loading correctness across FEED_* configurations.
 *
 * Seeds 14 published articles (feed-01..feed-14, all tagged "common",
 * feed-10..14 also "beta") whose bodies carry a BODY-<slug> marker beyond the
 * 200-char preview, then verifies — under three different server env configs —
 * that infinite scroll loads the whole feed exactly once, expanded cards
 * always have a body (self-fetching when the server didn't inline it),
 * /article/<slug> deep links land aligned with content, tag switches reset
 * cleanly, and an in-flight untagged page cannot corrupt a tag switch.
 *
 * This file owns its test server (custom FEED_* env per describe block), so
 * it runs in the runner's own-server phase — see scripts/run-e2e.ts.
 */
import { setup, teardown } from "./setup";
import { PrismaClient } from "../../src/generated/prisma/client/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

const adapter = new PrismaLibSql({ url: "file:./test.sqlite" });
const prisma = new PrismaClient({ adapter });

const ALL = Array.from({ length: 14 }, (_, i) => `feed-${String(i + 1).padStart(2, "0")}`);
const BETA = ALL.slice(9); // feed-10..feed-14

/** ~150-char paragraph of article body HTML. */
function paragraph(slug: string, i: number): string {
  const filler = "lorem ipsum dolor sit amet, consectetur adipiscing elit. ";
  const text = `Paragraph ${i + 1} of ${slug}. ${filler.repeat(3)}`.slice(0, 150);
  return `<p>${text}</p>`;
}

async function seedFeedArticles(): Promise<void> {
  await prisma.article.deleteMany({
    where: {
      slug: { in: ["test-article-1", "test-article-2", "test-article-3"] },
    },
  });
  for (const slug of ["common", "beta"]) {
    await prisma.tag.upsert({
      where: { slug },
      update: {},
      create: { name: slug, slug },
    });
  }
  for (let n = 1; n <= 14; n++) {
    const slug = `feed-${String(n).padStart(2, "0")}`;
    const content =
      paragraph(slug, 0) +
      paragraph(slug, 1) +
      paragraph(slug, 2) +
      `<p>BODY-${slug}</p>`;
    await prisma.article.create({
      data: {
        slug,
        title: `Feed Article ${String(n).padStart(2, "0")}`,
        content,
        published: true,
        // feed-01 newest .. feed-14 oldest, all distinct.
        publishedAt: new Date(Date.now() - n * 60_000),
        locale: "en",
        tags: {
          connect: [
            { slug: "common" },
            ...(n >= 10 ? [{ slug: "beta" }] : []),
          ],
        },
      },
    });
  }
}

async function ids(page: any): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="article-card"]')).map(
      (a) => a.id,
    ),
  );
}

/** Scroll to the bottom until "— end of feed —" shows and the count is stable. */
async function loadAll(page: any): Promise<string[]> {
  let prevCount = -1;
  let stable = 0;
  for (let i = 0; i < 40; i++) {
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    await new Promise((r) => setTimeout(r, 400));
    const state = await page.evaluate(() => ({
      end: document.body.innerText.includes("— end of feed —"),
      count: document.querySelectorAll('[data-testid="article-card"]').length,
    }));
    if (state.end && state.count === prevCount) {
      stable++;
      if (stable >= 2) break;
    } else {
      stable = 0;
    }
    prevCount = state.count;
  }
  return ids(page);
}

interface CardState {
  id: string;
  hasFullTextButton: boolean;
  bodyHasMarker: boolean;
}

async function cardState(page: any): Promise<CardState[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="article-card"]')).map(
      (card) => {
        const hasFullTextButton = Array.from(card.querySelectorAll("button"))
          .some((b) => (b.textContent ?? "").trim() === "Full text");
        const body = card.querySelector(".article-body");
        const marker = `BODY-${card.id}`;
        return {
          id: card.id,
          hasFullTextButton,
          bodyHasMarker: (body?.textContent ?? "").includes(marker),
        };
      },
    ),
  );
}

/** A card is never blank: exactly one of {Full text button, body marker}. */
function expectNoBlankCards(states: CardState[]): void {
  for (const s of states) {
    expect(s.hasFullTextButton !== s.bodyHasMarker).toBe(true);
  }
}

async function clickTag(page: any, label: string): Promise<void> {
  await page.evaluate((l: string) => {
    const btn = Array.from(
      document.querySelectorAll('[data-testid="tag-bar"] button'),
    ).find((b) => (b.textContent ?? "").trim().startsWith(l));
    if (!btn) throw new Error(`tag button not found: ${l}`);
    (btn as HTMLButtonElement).click();
  }, label);
}

async function noArticlesYet(page: any): Promise<boolean> {
  return page.evaluate(() =>
    document.body.innerText.includes("No articles yet."),
  );
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
    const bottom = (el: Element | null) =>
      el?.getBoundingClientRect().bottom ?? null;
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
  expect(m.headerTop!).toBeGreaterThanOrEqual(m.navBottom! - 1);
  expect(m.titleTop!).toBeGreaterThanOrEqual(m.navBottom! - 1);
  expect(m.titleBottom!).toBeLessThanOrEqual(m.viewportH);
  expect(Math.abs(m.anchorTop! - m.navBottom!)).toBeLessThanOrEqual(3);
}

async function gotoHome(page: any, baseUrl: string): Promise<void> {
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${baseUrl}/`, {
    waitUntil: "networkidle0",
    timeout: 60_000,
  });
}

async function gotoArticle(page: any, baseUrl: string, slug: string): Promise<void> {
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${baseUrl}/article/${slug}`, {
    waitUntil: "networkidle0",
    timeout: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Config A: pageSize 3, no prefetch, expandedCount 1, expandAll false.
// ---------------------------------------------------------------------------
describe("feed loading (pageSize=3, prefetch=0, expanded=1)", () => {
  let context: Awaited<ReturnType<typeof setup>>;

  beforeAll(async () => {
    context = await setup(seedFeedArticles, {
      env: {
        FEED_PAGE_SIZE: "3",
        FEED_PREFETCH_PAGES: "0",
        FEED_EXPANDED_COUNT: "1",
        FEED_EXPAND_ALL: "false",
      },
    });
  }, 240_000);

  afterAll(async () => {
    await prisma.$disconnect();
    await teardown(context);
  }, 30_000);

  it("A1: home infinite scroll loads every article exactly once", async () => {
    const { page, baseUrl } = context;
    await gotoHome(page, baseUrl);
    const got = await loadAll(page);
    console.log("A1 ids:", JSON.stringify(got));
    expect(got).toEqual(ALL);
  }, 120_000);

  it("A2: expanded cards have bodies, collapsed cards have the button", async () => {
    const { page } = context;
    await loadAll(page);
    const states = await cardState(page);
    console.log("A2 cardState:", JSON.stringify(states.slice(0, 4)));
    expectNoBlankCards(states);
    const byId = new Map(states.map((s) => [s.id, s]));
    expect(byId.get("feed-01")?.bodyHasMarker).toBe(true);
    expect(byId.get("feed-02")?.hasFullTextButton).toBe(true);
  }, 120_000);

  it("A3: deep article link scrolls aligned with the target expanded", async () => {
    const { page, baseUrl } = context;
    await gotoArticle(page, baseUrl, "feed-09");
    await page.waitForSelector("#feed-09-top", { timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 3000));
    const states = await cardState(page);
    const target = states.find((s) => s.id === "feed-09");
    console.log("A3 feed-09 state:", JSON.stringify(target));
    expect(target?.bodyHasMarker).toBe(true);
    const m = await measure(page, "feed-09");
    console.log("A3 measure:", JSON.stringify(m));
    expectAligned(m);
    const got = await loadAll(page);
    console.log("A3 ids:", JSON.stringify(got));
    expect(got).toEqual(ALL);
  }, 120_000);

  it("A4: tag-scoped article link loads only that tag's feed", async () => {
    const { page, baseUrl } = context;
    await gotoArticle(page, baseUrl, "feed-13");
    await page.waitForSelector("#feed-13-top", { timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 1000));
    const states = await cardState(page);
    const target = states.find((s) => s.id === "feed-13");
    console.log("A4 feed-13 state:", JSON.stringify(target));
    expect(target?.bodyHasMarker).toBe(true);
    const got = await loadAll(page);
    console.log("A4 ids:", JSON.stringify(got));
    expect(got).toEqual(BETA);
    expectNoBlankCards(await cardState(page));
  }, 120_000);

  it("A5: tag switching on home resets the feed cleanly", async () => {
    const { page, baseUrl } = context;
    await gotoHome(page, baseUrl);

    await clickTag(page, "#beta");
    let got = await loadAll(page);
    console.log("A5 #beta ids:", JSON.stringify(got));
    expect(got).toEqual(BETA);
    expect(await noArticlesYet(page)).toBe(false);

    await clickTag(page, "#common");
    got = await loadAll(page);
    console.log("A5 #common ids:", JSON.stringify(got));
    expect(got).toEqual(ALL);
    expect(await noArticlesYet(page)).toBe(false);

    await clickTag(page, "All");
    got = await loadAll(page);
    console.log("A5 All ids:", JSON.stringify(got));
    expect(got).toEqual(ALL);
    expect(await noArticlesYet(page)).toBe(false);
  }, 120_000);

  it("A6: switching tags on an article route keeps the target non-blank", async () => {
    const { page, baseUrl } = context;
    await gotoArticle(page, baseUrl, "feed-13");
    await page.waitForSelector("#feed-13-top", { timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 3000));

    await clickTag(page, "#common");
    const got = await loadAll(page);
    console.log("A6 ids:", JSON.stringify(got));
    expect(got).toEqual(ALL);

    // feed-13 stays expanded via initialTargetSlug but sits on page 5 of the
    // unscoped feed — its body arrives via the card's own fetch. Wait for it
    // (bounded) so the snapshot below isn't taken mid-load.
    try {
      await page.waitForFunction(
        () => {
          const card = document.getElementById("feed-13");
          const body = card?.querySelector(".article-body");
          return (
            !!body &&
            (body.textContent ?? "").includes("BODY-feed-13")
          );
        },
        { timeout: 15_000 },
      );
    } catch {
      // Fall through — the card-state assertions report the observed state.
    }

    const states = await cardState(page);
    console.log("A6 cardState:", JSON.stringify(states.filter((s) => s.id === "feed-13")));
    expectNoBlankCards(states);
    const target = states.find((s) => s.id === "feed-13");
    expect(target?.bodyHasMarker).toBe(true);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Config B: pageSize 2, prefetch 1, expandedCount 3, expandAll false.
// ---------------------------------------------------------------------------
describe("feed loading (pageSize=2, prefetch=1, expanded=3)", () => {
  let context: Awaited<ReturnType<typeof setup>>;

  beforeAll(async () => {
    context = await setup(seedFeedArticles, {
      env: {
        FEED_PAGE_SIZE: "2",
        FEED_PREFETCH_PAGES: "1",
        FEED_EXPANDED_COUNT: "3",
        FEED_EXPAND_ALL: "false",
      },
    });
  }, 240_000);

  afterAll(async () => {
    await prisma.$disconnect();
    await teardown(context);
  }, 30_000);

  it("B1: third expanded article self-loads its body from page 2", async () => {
    const { page, baseUrl } = context;
    await gotoHome(page, baseUrl);
    const got = await loadAll(page);
    console.log("B1 ids:", JSON.stringify(got));
    expect(got).toEqual(ALL);

    // feed-03 sits on page 2 — the server only inlines content for page-1
    // items, so the card must fetch its own body.
    await page.waitForFunction(
      () => {
        const card = document.getElementById("feed-03");
        return (
          !!card?.querySelector(".article-body") &&
          (card.querySelector(".article-body")?.textContent ?? "").includes(
            "BODY-feed-03",
          )
        );
      },
      { timeout: 15_000 },
    );
    const states = await cardState(page);
    console.log("B1 cardState:", JSON.stringify(states.slice(0, 5)));
    expectNoBlankCards(states);
    const byId = new Map(states.map((s) => [s.id, s]));
    for (const slug of ["feed-01", "feed-02", "feed-03"]) {
      expect(byId.get(slug)?.bodyHasMarker).toBe(true);
    }
    for (const slug of ALL.slice(3)) {
      expect(byId.get(slug)?.hasFullTextButton).toBe(true);
    }
  }, 120_000);

  it("B2: article route at the top expands the first N via the locator", async () => {
    const { page, baseUrl } = context;
    await gotoArticle(page, baseUrl, "feed-01");
    await page.waitForSelector("#feed-01-top", { timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 3000));
    const early = await cardState(page);
    console.log("B2 early cardState:", JSON.stringify(early.slice(0, 4)));

    await page.waitForFunction(
      () => {
        for (const slug of ["feed-01", "feed-02", "feed-03"]) {
          const card = document.getElementById(slug);
          const body = card?.querySelector(".article-body");
          if (
            !body ||
            !(body.textContent ?? "").includes(`BODY-${slug}`)
          ) {
            return false;
          }
        }
        return true;
      },
      { timeout: 10_000 },
    );
    const states = await cardState(page);
    expectNoBlankCards(states);
    const got = await loadAll(page);
    console.log("B2 ids:", JSON.stringify(got));
    expect(got).toEqual(ALL);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Config C: pageSize 3, prefetch 3, expandAll true (production-like).
// ---------------------------------------------------------------------------
describe("feed loading (pageSize=3, prefetch=3, expandAll)", () => {
  let context: Awaited<ReturnType<typeof setup>>;

  beforeAll(async () => {
    context = await setup(seedFeedArticles, {
      env: {
        FEED_PAGE_SIZE: "3",
        FEED_PREFETCH_PAGES: "3",
        FEED_EXPAND_ALL: "true",
      },
    });
  }, 240_000);

  afterAll(async () => {
    await prisma.$disconnect();
    await teardown(context);
  }, 30_000);

  it("C1: home loads all articles fully expanded", async () => {
    const { page, baseUrl } = context;
    await gotoHome(page, baseUrl);
    const got = await loadAll(page);
    console.log("C1 ids:", JSON.stringify(got));
    expect(got).toEqual(ALL);
    const states = await cardState(page);
    console.log("C1 cardState:", JSON.stringify(states.slice(0, 3)));
    for (const s of states) {
      expect(s.bodyHasMarker).toBe(true);
      expect(s.hasFullTextButton).toBe(false);
    }
  }, 120_000);

  it("C2: deep article link aligns and expands everything", async () => {
    const { page, baseUrl } = context;
    await gotoArticle(page, baseUrl, "feed-09");
    await page.waitForSelector("#feed-09-top", { timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 3000));
    const m = await measure(page, "feed-09");
    console.log("C2 measure:", JSON.stringify(m));
    expectAligned(m);
    const got = await loadAll(page);
    console.log("C2 ids:", JSON.stringify(got));
    expect(got).toEqual(ALL);
    const states = await cardState(page);
    for (const s of states) {
      expect(s.bodyHasMarker).toBe(true);
    }
  }, 120_000);

  it("C3: tag switch supersedes an in-flight untagged page", async () => {
    const { page, baseUrl } = context;
    await page.setViewport({ width: 1280, height: 900 });

    // Delay untagged cursor page requests so a tag click can land mid-flight.
    let sawUntaggedCursorRequest = false;
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      try {
        const u = new URL(req.url());
        if (
          u.pathname === "/api/feed" &&
          u.searchParams.has("cursor") &&
          !u.searchParams.has("tag")
        ) {
          sawUntaggedCursorRequest = true;
          setTimeout(() => void req.continue(), 1200);
          return;
        }
      } catch {
        // non-URL request — continue below
      }
      void req.continue();
    });

    try {
      await page.goto(`${baseUrl}/`, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      // Keep re-scrolling to the bottom until a cursor request fires — async
      // layout (syntax highlighting) can push the sentinel back out of the
      // observer's margin after a single scroll.
      const flagDeadline = Date.now() + 20_000;
      while (!sawUntaggedCursorRequest && Date.now() < flagDeadline) {
        await page.evaluate(() =>
          window.scrollTo(0, document.documentElement.scrollHeight),
        );
        await new Promise((r) => setTimeout(r, 400));
      }
      expect(sawUntaggedCursorRequest).toBe(true);

      await clickTag(page, "#beta");
      await new Promise((r) => setTimeout(r, 4000));
      const got = await loadAll(page);
      console.log("C3 ids:", JSON.stringify(got));
      expect(got).toEqual(BETA);
      expect(await noArticlesYet(page)).toBe(false);
    } finally {
      await page.setRequestInterception(false);
    }
  }, 120_000);
});
