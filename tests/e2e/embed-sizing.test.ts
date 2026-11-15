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
});
