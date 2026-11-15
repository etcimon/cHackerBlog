/**
 * E2E: the rich editor's "size" toolbar item resizes a pasted base64 image
 * and a code block, and the markdown round-trip keeps working — the textarea
 * shows a short "[base64 data]" placeholder while preview/save keep the real
 * data URL.
 *
 * Seeds an article with a plain <img> carrying a data: URL and a collapsible-
 * capable code block, then drives the size dialog through the UI and asserts
 * the stored content after save.
 *
 * Runs against the test server started by tests/e2e/setup.ts (port 3001,
 * test.sqlite). See tests/README.md.
 */
import { setup, teardown, loginAsAdmin } from "./setup";
import { PrismaClient } from "../../src/generated/prisma/client/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { buildCodeBlock, escapeCode } from "@/lib/code-block-render";

const adapter = new PrismaLibSql({ url: "file:./test.sqlite" });
const prisma = new PrismaClient({ adapter });

const DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const DATA_B =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const DATA_C =
  "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

const JS_LINES = Array.from(
  { length: 10 },
  (_, i) => `const value${i} = ${i};`,
).join("\n");

async function seedSizingArticle(): Promise<void> {
  await prisma.article.updateMany({
    where: { slug: { in: ["test-article-1", "test-article-2", "test-article-3"] } },
    data: { publishedAt: new Date("2020-01-01") },
  });

  const content =
    "<p>Intro.</p>" +
    `<p><img src="${DATA_URL}" alt="pasted"></p>` +
    buildCodeBlock(
      escapeCode(JS_LINES),
      "javascript",
      10,
      { collapseKind: "preview", size: { type: "none" } },
      false,
    ) +
    "<p>Outro.</p>";

  await prisma.article.create({
    data: {
      slug: "sizing-a",
      title: "Sizing A",
      content,
      published: true,
      publishedAt: new Date(),
      locale: "en",
    },
  });

  // Three base64 images — two share payload A, the middle one carries a
  // markdown title — to exercise placeholder numbering/swap/paste in the
  // markdown editor. publishedAt keeps it below sizing-a in the feed.
  await prisma.article.create({
    data: {
      slug: "multi-b64",
      title: "Multi B64",
      content:
        "<p>One.</p>" +
        `<p><img src="${DATA_URL}" alt="first"></p>` +
        `<p><img src="${DATA_B}" alt="second" title="Second title"></p>` +
        `<p><img src="${DATA_URL}" alt="first again"></p>` +
        "<p>End.</p>",
      published: true,
      publishedAt: new Date(Date.now() - 60_000),
      locale: "en",
    },
  });
}

const EDITOR = 'div.article-body[contenteditable="true"]';
const SIZE_BTN = '[data-testid="size-button"]';

async function sizeButtonEnabled(page: any): Promise<void> {
  await page.waitForFunction(
    (sel: string) => {
      const b = document.querySelector(sel) as HTMLButtonElement | null;
      return !!b && !b.disabled;
    },
    { timeout: 10_000 },
    SIZE_BTN,
  );
}

describe("WYSIWYG size toolbar", () => {
  let context: Awaited<ReturnType<typeof setup>>;

  beforeAll(async () => {
    context = await setup(seedSizingArticle);
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
    await teardown(context);
  }, 10_000);

  it("resizes image + code block and round-trips base64 through markdown", async () => {
    const { page, baseUrl } = context;
    await page.setViewport({ width: 1280, height: 900 });
    await loginAsAdmin(context);
    await page.goto(`${baseUrl}/`, {
      waitUntil: "networkidle0",
      timeout: 60_000,
    });
    await page.waitForSelector('#sizing-a button[title="Edit article"]', {
      timeout: 30_000,
    });
    await page.evaluate(() => {
      document
        .querySelector('#sizing-a button[title="Edit article"]')
        ?.scrollIntoView({ block: "center" });
    });
    await new Promise((r) => setTimeout(r, 300));
    await page.click('#sizing-a button[title="Edit article"]');

    // Wait for the editor surface with the seeded image.
    await page.waitForSelector(`${EDITOR} img`, { timeout: 30_000 });

    // 1. No size-capable element selected -> button disabled.
    const initiallyDisabled = await page.$eval(
      SIZE_BTN,
      (b) => (b as HTMLButtonElement).disabled,
    );
    expect(initiallyDisabled).toBe(true);

    // 2. Click the image -> enabled -> dialog -> medium -> apply.
    await page.click(`${EDITOR} img`);
    await sizeButtonEnabled(page);
    await page.click(SIZE_BTN);
    await page.waitForSelector('[data-testid="embed-size-dialog"]', {
      timeout: 10_000,
    });
    await page.select('[data-testid="size-mode"]', "medium");
    await page.click('[data-testid="size-apply"]');
    await page.waitForFunction(
      (sel: string) => {
        const img = document.querySelector(`${sel} img.cb-img--size-medium`);
        return !!img && img.getAttribute("data-size") === "medium";
      },
      { timeout: 10_000 },
      EDITOR,
    );

    // 3. Click inside the code block -> small + 3 preview lines.
    await page.click(`${EDITOR} .cb-code pre code`);
    await sizeButtonEnabled(page);
    await page.click(SIZE_BTN);
    await page.waitForSelector('[data-testid="embed-size-dialog"]', {
      timeout: 10_000,
    });
    await page.select('[data-testid="size-mode"]', "small");
    await page.type('[data-testid="size-preview-lines"]', "3");
    await page.click('[data-testid="size-apply"]');
    await page.waitForFunction(
      (sel: string) => {
        const cb = document.querySelector(`${sel} .cb-code`);
        return (
          !!cb &&
          cb.getAttribute("data-preview-lines") === "3" &&
          cb.classList.contains("cb-code--size-small")
        );
      },
      { timeout: 10_000 },
      EDITOR,
    );

    // 4. Markdown mode: placeholder in textarea, real data in preview.
    await page.click('button[title="Switch to Markdown"]');
    const md = await page.waitForFunction(
      () => {
        const ta = document.querySelector(
          'textarea[placeholder="Write in Markdown..."]',
        ) as HTMLTextAreaElement | null;
        return ta && ta.value.includes("[base64 data]") ? ta.value : null;
      },
      { timeout: 15_000 },
    );
    const mdText = await md.jsonValue();
    console.log("markdown textarea:", JSON.stringify(mdText));
    expect(mdText).toContain("![pasted]([base64 data]){medium}");
    expect(mdText).toContain("```javascript small preview=3");
    expect(mdText).not.toContain("base64,");

    await page.waitForFunction(
      () => {
        const img = document.querySelector(
          '[data-testid="md-preview"] img.cb-img--size-medium',
        ) as HTMLImageElement | null;
        return !!img && (img.getAttribute("src") || "").startsWith("data:image/png;base64,");
      },
      { timeout: 15_000 },
    );

    // 5. Save and check the stored content.
    const submit = await page.waitForSelector('button[type="submit"]', {
      timeout: 10_000,
    });
    await submit!.click();
    await page.waitForFunction(
      () => !document.querySelector('div.article-body[contenteditable="true"]'),
      { timeout: 20_000 },
    );

    // The libsql client can serve a stale snapshot briefly after the server's
    // write commits; poll until the new content is visible.
    let row = await prisma.article.findUnique({ where: { slug: "sizing-a" } });
    for (
      let i = 0;
      i < 20 && !(row?.content ?? "").includes("cb-img--size-medium");
      i++
    ) {
      await new Promise((r) => setTimeout(r, 250));
      row = await prisma.article.findUnique({ where: { slug: "sizing-a" } });
    }
    const content = row?.content ?? "";
    console.log(
      "saved content checks:",
      JSON.stringify({
        hasDataUrl: content.includes("data:image/png;base64,iVBOR"),
        hasSizeClass: content.includes("cb-img--size-medium"),
        hasPreviewLines: content.includes('data-preview-lines="3"'),
        hasPlaceholder: content.includes("[base64 data]"),
      }),
    );
    expect(content).toContain("data:image/png;base64,iVBOR");
    expect(content).toContain("cb-img--size-medium");
    expect(content).toContain('data-preview-lines="3"');
    expect(content).not.toContain("[base64 data]");
  }, 180_000);

  it("keeps several different base64 images apart in the markdown editor", async () => {
    const { page, baseUrl } = context;
    await page.setViewport({ width: 1280, height: 900 });
    await loginAsAdmin(context);
    await page.goto(`${baseUrl}/`, {
      waitUntil: "networkidle0",
      timeout: 60_000,
    });
    await page.waitForSelector('#multi-b64 button[title="Edit article"]', {
      timeout: 30_000,
    });
    await page.evaluate(() => {
      document
        .querySelector('#multi-b64 button[title="Edit article"]')
        ?.scrollIntoView({ block: "center" });
    });
    await new Promise((r) => setTimeout(r, 300));
    await page.click('#multi-b64 button[title="Edit article"]');

    // Wait for the three seeded images, then size the first one to medium.
    await page.waitForFunction(
      (sel: string) => document.querySelectorAll(`${sel} img`).length === 3,
      { timeout: 30_000 },
      EDITOR,
    );
    await page.click(`${EDITOR} img`);
    await sizeButtonEnabled(page);
    await page.click(SIZE_BTN);
    await page.waitForSelector('[data-testid="embed-size-dialog"]', {
      timeout: 10_000,
    });
    await page.select('[data-testid="size-mode"]', "medium");
    await page.click('[data-testid="size-apply"]');
    await page.waitForFunction(
      (sel: string) =>
        !!document.querySelector(`${sel} img.cb-img--size-medium`),
      { timeout: 10_000 },
      EDITOR,
    );

    // Markdown mode: distinct payloads get numbered placeholders, the titled
    // image keeps its title, and the repeated payload shares placeholder 1.
    await page.click('button[title="Switch to Markdown"]');
    const md = await page.waitForFunction(
      () => {
        const ta = document.querySelector(
          'textarea[placeholder="Write in Markdown..."]',
        ) as HTMLTextAreaElement | null;
        return ta && ta.value.includes("[base64 data]") ? ta.value : null;
      },
      { timeout: 15_000 },
    );
    const mdText = (await md.jsonValue()) as string;
    console.log("multi-b64 markdown:", JSON.stringify(mdText));
    const iFirst = mdText.indexOf("![first]([base64 data]){medium}");
    const iSecond = mdText.indexOf(
      '![second]([base64 data 2] "Second title")',
    );
    const iThird = mdText.indexOf("![first again]([base64 data])");
    expect(iFirst).toBeGreaterThanOrEqual(0);
    expect(iSecond).toBeGreaterThan(iFirst);
    expect(iThird).toBeGreaterThan(iSecond);
    expect(mdText).not.toContain("base64,");

    // Preview expands placeholders back to the real data URLs, in order.
    await page.waitForFunction(
      () =>
        document.querySelectorAll('[data-testid="md-preview"] img').length ===
        3,
      { timeout: 15_000 },
    );
    const previewSrcs1 = await page.$$eval(
      '[data-testid="md-preview"] img',
      (els) =>
        els.map((el) => (el as HTMLImageElement).getAttribute("src") ?? ""),
    );
    console.log(
      "preview srcs before edit:",
      JSON.stringify(previewSrcs1.map((s) => s.slice(0, 30))),
    );
    expect(previewSrcs1).toEqual([DATA_URL, DATA_B, DATA_URL]);

    // Author edits the markdown: swap the first two placeholders and paste a
    // fresh data URL over the third image's placeholder.
    const editedMd = mdText
      .replace(
        "![first]([base64 data]){medium}",
        "![first]([base64 data 2]){medium}",
      )
      .replace(
        '![second]([base64 data 2] "Second title")',
        '![second]([base64 data] "Second title")',
      )
      .replace("![first again]([base64 data])", `![third](${DATA_C})`);
    await page.evaluate((value: string) => {
      const ta = document.querySelector(
        'textarea[placeholder="Write in Markdown..."]',
      ) as HTMLTextAreaElement | null;
      if (!ta) throw new Error("markdown textarea not found");
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(ta, value);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }, editedMd);

    // Preview now shows B, A, C — each placeholder keeps its own data.
    await page.waitForFunction(
      (expected: string[]) => {
        const imgs = Array.from(
          document.querySelectorAll('[data-testid="md-preview"] img'),
        ) as HTMLImageElement[];
        const srcs = imgs.map((i) => i.getAttribute("src") ?? "");
        return (
          srcs.length === expected.length &&
          srcs.every((s, idx) => s === expected[idx])
        );
      },
      { timeout: 15_000 },
      [DATA_B, DATA_URL, DATA_C],
    );
    const previewSrcs2 = await page.$$eval(
      '[data-testid="md-preview"] img',
      (els) =>
        els.map((el) => (el as HTMLImageElement).getAttribute("src") ?? ""),
    );
    console.log(
      "preview srcs after edit:",
      JSON.stringify(previewSrcs2.map((s) => s.slice(0, 30))),
    );
    expect(previewSrcs2).toEqual([DATA_B, DATA_URL, DATA_C]);
    const firstClass = await page.$eval(
      '[data-testid="md-preview"] img',
      (el) => el.getAttribute("class") ?? "",
    );
    expect(firstClass).toContain("cb-img--size-medium");

    // Save and check the stored content.
    const submit = await page.waitForSelector('button[type="submit"]', {
      timeout: 10_000,
    });
    await submit!.click();
    await page.waitForFunction(
      () => !document.querySelector('div.article-body[contenteditable="true"]'),
      { timeout: 20_000 },
    );

    // Same stale-snapshot poll as the first test: wait for C's payload.
    let row = await prisma.article.findUnique({
      where: { slug: "multi-b64" },
    });
    for (
      let i = 0;
      i < 20 && !(row?.content ?? "").includes(DATA_C);
      i++
    ) {
      await new Promise((r) => setTimeout(r, 250));
      row = await prisma.article.findUnique({ where: { slug: "multi-b64" } });
    }
    const content = row?.content ?? "";
    const savedSrcs = Array.from(
      content.matchAll(/\ssrc="(data:[^"]+)"/g),
    ).map((m) => m[1]);
    console.log(
      "saved src order:",
      JSON.stringify(savedSrcs.map((s) => s.slice(0, 30))),
    );
    expect(content).toContain(DATA_URL);
    expect(content).toContain(DATA_B);
    expect(content).toContain(DATA_C);
    expect(savedSrcs).toEqual([DATA_B, DATA_URL, DATA_C]);
    expect(content).not.toContain("[base64 data]");

    // Reopen: collapse re-numbers by first appearance in the saved order.
    await page.waitForSelector('#multi-b64 button[title="Edit article"]', {
      timeout: 30_000,
    });
    await page.evaluate(() => {
      document
        .querySelector('#multi-b64 button[title="Edit article"]')
        ?.scrollIntoView({ block: "center" });
    });
    await new Promise((r) => setTimeout(r, 300));
    await page.click('#multi-b64 button[title="Edit article"]');
    await page.waitForSelector(`${EDITOR} img`, { timeout: 30_000 });
    await page.click('button[title="Switch to Markdown"]');
    const md2 = await page.waitForFunction(
      () => {
        const ta = document.querySelector(
          'textarea[placeholder="Write in Markdown..."]',
        ) as HTMLTextAreaElement | null;
        return ta && ta.value.includes("[base64 data]") ? ta.value : null;
      },
      { timeout: 15_000 },
    );
    const md2Text = (await md2.jsonValue()) as string;
    console.log("multi-b64 markdown after save:", JSON.stringify(md2Text));
    const jFirst = md2Text.indexOf("![first]([base64 data]){medium}");
    const jSecond = md2Text.indexOf(
      '![second]([base64 data 2] "Second title")',
    );
    const jThird = md2Text.indexOf("![third]([base64 data 3])");
    expect(jFirst).toBeGreaterThanOrEqual(0);
    expect(jSecond).toBeGreaterThan(jFirst);
    expect(jThird).toBeGreaterThan(jSecond);
    expect(md2Text).not.toContain("base64,");
  }, 180_000);
});
