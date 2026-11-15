/**
 * E2E: link-preview card hydration must survive article re-saves.
 *
 * Regression test for the bug where a generic link card "sometimes" lost its
 * fetched title/description and showed only the bare host + URL: the client
 * marked hydrated cards with a `data-link-hydrated` DOM attribute, the rich
 * editor persists innerHTML on save, and stored copies of that marker made
 * later renders skip hydration entirely.
 *
 * Seeds an article with two identical cards — one carrying a stale
 * `data-link-hydrated="1"` marker (as an old save would have left it) and one
 * clean — then intercepts /api/link-preview so no real network call happens.
 * Test 1 asserts both cards hydrate anyway; test 2 saves the article from the
 * rich editor and asserts the marker is never persisted into the content.
 *
 * Runs against the test server started by tests/e2e/setup.ts (port 3001,
 * test.sqlite). See tests/README.md.
 */
import { setup, teardown, loginAsAdmin } from "./setup";
import { PrismaClient } from "../../src/generated/prisma/client/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { buildUrlEmbedHtml } from "@/lib/embeds";

const adapter = new PrismaLibSql({ url: "file:./test.sqlite" });
const prisma = new PrismaClient({ adapter });

const GITHUB_URL = "https://github.com/etcimon/GSys-LibreCore";
const CARD_TITLE = "etcimon/GSys-LibreCore";

/** Counts intercepted /api/link-preview requests (module state, Node side). */
let previewRequests = 0;

function cardHtml(stale: boolean): string {
  const clean = buildUrlEmbedHtml({ url: GITHUB_URL });
  if (!stale) return clean;
  const marked = clean.replace(
    'data-link-hydrate="1"',
    'data-link-hydrate="1" data-link-hydrated="1"',
  );
  if (marked === clean) {
    throw new Error("seed: data-link-hydrate marker not found in card HTML");
  }
  return marked;
}

async function seedLinkEmbedArticle(): Promise<void> {
  // Push the default articles far into the past so link-embed-a owns the top
  // of the feed (publishedAt desc) and renders expanded.
  await prisma.article.updateMany({
    where: { slug: { in: ["test-article-1", "test-article-2", "test-article-3"] } },
    data: { publishedAt: new Date("2020-01-01") },
  });

  const content =
    "<p>Intro paragraph.</p>" +
    cardHtml(true) +
    cardHtml(false) +
    "<p>Outro paragraph.</p>";

  await prisma.article.create({
    data: {
      slug: "link-embed-a",
      title: "Link Embed A",
      content,
      published: true,
      publishedAt: new Date(),
      locale: "en",
    },
  });
}

/** Wait until both cards under #link-embed-a show the fetched title. */
async function waitHydrated(page: any): Promise<void> {
  try {
    await page.waitForFunction(
      (expected: string) => {
        const figs = document.querySelectorAll(
          "#link-embed-a figure.cb-embed--link",
        );
        if (figs.length !== 2) return false;
        return Array.from(figs).every(
          (f) => f.querySelector(".cb-embed__title")?.textContent === expected,
        );
      },
      { timeout: 15_000 },
      CARD_TITLE,
    );
  } catch (e) {
    const diag = await page.evaluate(() => {
      const art = document.getElementById("link-embed-a");
      const figs = art
        ? Array.from(art.querySelectorAll("figure.cb-embed--link"))
        : [];
      return {
        articleFound: !!art,
        figCount: figs.length,
        titles: figs.map(
          (f) => f.querySelector(".cb-embed__title")?.textContent,
        ),
        marked: art
          ? art.querySelectorAll("[data-link-hydrated]").length
          : null,
        bodyPresent: !!art?.querySelector(".article-body"),
        bodyLen: art?.querySelector(".article-body")?.innerHTML.length ?? null,
      };
    });
    console.log(
      "waitHydrated DIAG:",
      JSON.stringify(diag),
      "previewRequests:",
      previewRequests,
    );
    throw e;
  }
}

describe("Link embed hydration survives re-saves", () => {
  let context: Awaited<ReturnType<typeof setup>>;

  beforeAll(async () => {
    context = await setup(seedLinkEmbedArticle);

    // Mock /api/link-preview for the whole session: answer every request
    // locally so no real fetch to GitHub (or anywhere) can happen.
    await context.page.setRequestInterception(true);
    context.page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/link-preview") {
        previewRequests++;
        void request.respond({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            data: {
              url: url.searchParams.get("url") ?? "",
              title: CARD_TITLE,
              description: "Hydrated description",
              siteName: "GitHub",
            },
          }),
        });
        return;
      }
      void request.continue();
    });
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
    await teardown(context);
  }, 10_000);

  it("a stale hydrated marker in stored HTML does not block hydration", async () => {
    const { page, baseUrl } = context;
    previewRequests = 0;
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`${baseUrl}/`, {
      waitUntil: "networkidle0",
      timeout: 60_000,
    });
    await waitHydrated(page);
    const marked = await page.evaluate(
      () => document.querySelectorAll("#link-embed-a [data-link-hydrated]").length,
    );
    console.log("stale-marker test: marked attrs =", marked, "previewRequests =", previewRequests);
    expect(marked).toBe(0);
    // Two cards share one URL -> the per-URL cache collapses them into a
    // single request.
    expect(previewRequests).toBe(1);

    // Unrelated re-renders must not re-inject the body HTML: tag the figure
    // nodes with an expando, wait for the expand animation's setExpandedDone
    // re-render, and confirm the same nodes (and titles) survived.
    await page.evaluate(() => {
      document
        .querySelectorAll("#link-embed-a figure.cb-embed--link")
        .forEach((fig) => ((fig as any).__e2eKeep = true));
    });
    await new Promise((r) => setTimeout(r, 2000));
    const persisted = await page.evaluate(() => {
      const figs = Array.from(
        document.querySelectorAll("#link-embed-a figure.cb-embed--link"),
      );
      return {
        titles: figs.map(
          (f) => f.querySelector(".cb-embed__title")?.textContent,
        ),
        keep: figs.map((f) => (f as any).__e2eKeep === true),
      };
    });
    console.log("persistence check:", JSON.stringify(persisted));
    expect(persisted.titles).toEqual([CARD_TITLE, CARD_TITLE]);
    expect(persisted.keep).toEqual([true, true]);
  }, 90_000);

  it("saving from the rich editor never persists the hydration marker", async () => {
    const { page, baseUrl } = context;
    await page.setViewport({ width: 1280, height: 900 });
    await loginAsAdmin(context);
    await page.goto(`${baseUrl}/`, {
      waitUntil: "networkidle0",
      timeout: 60_000,
    });
    await page.waitForSelector('#link-embed-a button[title="Edit article"]', {
      timeout: 30_000,
    });
    // Center the button first: the floating admin bar (bottom-left, z-40) can
    // cover it when it sits near the bottom of the viewport.
    await page.evaluate(() => {
      document
        .querySelector('#link-embed-a button[title="Edit article"]')
        ?.scrollIntoView({ block: "center" });
    });
    await new Promise((r) => setTimeout(r, 300));
    await page.click('#link-embed-a button[title="Edit article"]');

    // The editor must hydrate both cards (the stale-marked one included)
    // before we touch the content.
    await page.waitForFunction(
      (expected: string) => {
        const ed = document.querySelector(
          'div.article-body[contenteditable="true"]',
        );
        if (!ed) return false;
        const figs = ed.querySelectorAll("figure.cb-embed--link");
        return (
          figs.length === 2 &&
          Array.from(figs).every(
            (f) => f.querySelector(".cb-embed__title")?.textContent === expected,
          )
        );
      },
      { timeout: 30_000 },
      CARD_TITLE,
    );

    // Put the caret at the end of the last paragraph and type a marker.
    await page.evaluate(() => {
      const ed = document.querySelector<HTMLElement>(
        'div.article-body[contenteditable="true"]',
      );
      const ps = ed?.querySelectorAll("p");
      const p = ps && ps.length > 0 ? ps[ps.length - 1] : null;
      if (!ed || !p) return;
      ed.focus();
      const range = document.createRange();
      range.selectNodeContents(p);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
    await page.keyboard.type(` edited-${Date.now()}`);

    const submit = await page.waitForSelector('button[type="submit"]', {
      timeout: 10_000,
    });
    await submit!.click();

    // Wait for the editor modal to close.
    await page.waitForFunction(
      () => !document.querySelector('div.article-body[contenteditable="true"]'),
      { timeout: 20_000 },
    );

    // The libsql client can serve a stale snapshot briefly after the server's
    // write commits; poll until the new content is visible.
    let row = await prisma.article.findUnique({
      where: { slug: "link-embed-a" },
    });
    for (let i = 0; i < 20 && !(row?.content ?? "").includes("edited-"); i++) {
      await new Promise((r) => setTimeout(r, 250));
      row = await prisma.article.findUnique({
        where: { slug: "link-embed-a" },
      });
    }
    console.log(
      "saved content has edited-:",
      row?.content?.includes("edited-"),
      "| has data-link-hydrated:",
      row?.content?.includes("data-link-hydrated"),
    );
    expect(row?.content).toContain("edited-");
    expect(row?.content).not.toContain("data-link-hydrated");

    // And a fresh render still hydrates both cards.
    await page.goto(`${baseUrl}/`, {
      waitUntil: "networkidle0",
      timeout: 60_000,
    });
    await waitHydrated(page);
  }, 120_000);
});
