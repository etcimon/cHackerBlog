/**
 * E2E: code-block collapse/expand in the feed.
 *
 * Reproduces and guards two bugs:
 *   1. With many code blocks across infinitely-scrolled articles, the
 *      expand/collapse toggle stopped working for later blocks.
 *   2. After an article was edited in the WYSIWYG, expanding a code block in the
 *      feed would flicker straight back to collapsed.
 *
 * The test seeds 10 published articles, each with a single collapsible code
 * block in a different language and with a different size setting, drives the
 * real UI through Puppeteer, and asserts there are no uncaught page errors.
 *
 * Requires a running dev server (see tests/README.md). It connects to
 * TEST_BASE_URL (default http://localhost:3000) and uses the test SQLite db.
 */
import { setup, teardown, loginAsAdmin } from "./setup";
import { PrismaClient } from "../../src/generated/prisma/client/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

interface CodeArticleSpec {
  lang: string;
  label: string;
  /** CSS class + inline style + markdown-style spec mirroring buildCodeBlock. */
  size?: { cls: string; style: string; spec: string };
}

// 10 distinct languages with a spread of size settings (preset / pixels /
// percent / none) to exercise the full code-block matrix.
const SPECS: CodeArticleSpec[] = [
  { lang: "javascript", label: "JavaScript" },
  { lang: "typescript", label: "TypeScript", size: { cls: "cb-code--size-small", style: "", spec: "small" } },
  { lang: "python", label: "Python", size: { cls: "cb-code--size-medium", style: "", spec: "medium" } },
  { lang: "go", label: "Go", size: { cls: "cb-code--size-large", style: "", spec: "large" } },
  { lang: "rust", label: "Rust", size: { cls: "cb-code--size-pixels", style: "max-width:300px;", spec: "width=300" } },
  { lang: "java", label: "Java", size: { cls: "cb-code--size-percent", style: "width:80%;", spec: "80%" } },
  { lang: "cpp", label: "C++" },
  { lang: "ruby", label: "Ruby", size: { cls: "cb-code--size-small", style: "", spec: "small" } },
  { lang: "bash", label: "Bash", size: { cls: "cb-code--size-medium", style: "", spec: "medium" } },
  { lang: "sql", label: "SQL", size: { cls: "cb-code--size-pixels", style: "max-width:480px;", spec: "width=480" } },
];

const PREVIEW_LINES = 4;
const TOTAL_LINES = 12;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Build cb-code HTML identical in shape to wysiwyg.tsx buildCodeBlock. */
function buildCodeBlockHtml(spec: CodeArticleSpec): string {
  const lines = Array.from(
    { length: TOTAL_LINES },
    (_, i) => `${spec.lang}_line_${i + 1} = ${i + 1};`,
  );
  const body = lines.map(escapeHtml).join("\n");
  const collapsible = TOTAL_LINES > PREVIEW_LINES;

  const header =
    `<div class="cb-code__header" contenteditable="false">` +
    `<span class="cb-code__lang-icon"></span>` +
    `<span class="cb-code__lang">${spec.label}</span>` +
    `</div>`;
  const pre = `<pre class="cb-code__pre"><code class="language-${spec.lang}">${body}</code></pre>`;
  const toggle = collapsible
    ? `<button class="cb-code__toggle" type="button" contenteditable="false" ` +
      `aria-label="Expand code" aria-expanded="false"><svg class="cb-code__caret"></svg></button>`
    : "";

  const styleParts: string[] = [];
  if (spec.size?.style) styleParts.push(spec.size.style);
  if (collapsible) styleParts.push(`--cb-preview-lines:${PREVIEW_LINES};`);
  const styleAttr = styleParts.length ? ` style="${styleParts.join(" ")}"` : "";

  const cls = `cb-code${collapsible ? " collapsed" : ""}${spec.size?.cls ? ` ${spec.size.cls}` : ""}`;
  const data =
    `data-lines="${TOTAL_LINES}"` +
    (collapsible ? ` data-preview-lines="${PREVIEW_LINES}" data-collapse-kind="preview"` : "") +
    (spec.size?.spec ? ` data-size="${spec.size.spec}"` : "");

  return `<div class="${cls}" ${data}${styleAttr}>${header}${pre}${toggle}</div>`;
}

async function seedCodeArticles(): Promise<void> {
  const adapter = new PrismaLibSql({ url: "file:./test.sqlite" });
  const client = new PrismaClient({ adapter });
  try {
    // Take full control of the feed contents.
    await client.comment.deleteMany();
    await client.article.deleteMany();

    await client.siteSettings.upsert({
      where: { id: 1 },
      update: { setupComplete: true },
      create: {
        id: 1,
        title: "Test Blog",
        description: "Test Description",
        authorName: "Test Author",
        setupComplete: true,
      },
    });

    const base = Date.now();
    for (let i = 0; i < SPECS.length; i++) {
      const spec = SPECS[i];
      const content = `<p>Intro paragraph for ${spec.label}.</p>${buildCodeBlockHtml(spec)}`;
      await client.article.create({
        data: {
          slug: `code-article-${i + 1}`,
          title: `Code Article ${i + 1} — ${spec.label}`,
          content,
          published: true,
          // Descending so article 1 is newest and sits first in the feed.
          publishedAt: new Date(base - i * 60_000),
        },
      });
    }
  } finally {
    await client.$disconnect();
  }
}

// ---- Browser-side helpers (run inside page.evaluate) -----------------------

async function countCards(page: any): Promise<number> {
  return page.evaluate(
    () => document.querySelectorAll('[data-testid="article-card"]').length,
  );
}

/** Scroll until at least `target` article cards are present (infinite scroll). */
async function loadAllCards(page: any, target: number): Promise<void> {
  for (let attempt = 0; attempt < 25; attempt++) {
    if ((await countCards(page)) >= target) return;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise((r) => setTimeout(r, 600));
  }
  const got = await countCards(page);
  if (got < target) {
    throw new Error(`infinite scroll only produced ${got}/${target} cards`);
  }
}

/** Ensure the nth card's body is rendered (clicks "Full text" if needed). */
async function ensureNthOpen(page: any, n: number): Promise<void> {
  await page.evaluate((idx: number) => {
    const card = document.querySelectorAll('[data-testid="article-card"]')[idx];
    if (!card) return;
    if (!card.querySelector(".article-body")) {
      const btn = Array.from(card.querySelectorAll("button")).find((b) =>
        /Full text/i.test(b.textContent || ""),
      );
      (btn as HTMLButtonElement | undefined)?.click();
    }
  }, n);
  await page.waitForFunction(
    (idx: number) =>
      !!document
        .querySelectorAll('[data-testid="article-card"]')[idx]
        ?.querySelector(".cb-code"),
    { timeout: 10_000 },
    n,
  );
}

interface BlockState {
  expanded: boolean;
  collapsed: boolean;
  maxHeight: string | null;
}

async function readNthState(page: any, n: number): Promise<BlockState | null> {
  return page.evaluate((idx: number) => {
    const wrap = document
      .querySelectorAll('[data-testid="article-card"]')[idx]
      ?.querySelector(".cb-code");
    if (!wrap) return null;
    const pre = wrap.querySelector(".cb-code__pre");
    return {
      expanded: wrap.classList.contains("expanded"),
      collapsed: wrap.classList.contains("collapsed"),
      maxHeight: pre ? getComputedStyle(pre as Element).maxHeight : null,
    };
  }, n);
}

async function clickNthToggle(page: any, n: number): Promise<BlockState | null> {
  const before = await page.evaluate((idx: number) => {
    const wrap = document
      .querySelectorAll('[data-testid="article-card"]')[idx]
      ?.querySelector(".cb-code");
    const btn = wrap?.querySelector(".cb-code__toggle");
    if (!btn) return false;
    (btn as HTMLButtonElement).click();
    return true;
  }, n);
  if (!before) return null;
  return readNthState(page, n);
}

describe("Feed code-block collapse/expand", () => {
  let context: Awaited<ReturnType<typeof setup>>;
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  beforeAll(async () => {
    context = await setup();
    // Replace the default seed with our 10 code-block articles.
    await seedCodeArticles();

    context.page.on("pageerror", (err) => pageErrors.push(String(err)));
    context.page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
  }, 60_000);

  afterAll(async () => {
    await teardown(context);
  }, 10_000);

  it("loads 10 code articles via infinite scroll and toggles each block", async () => {
    const { page, baseUrl } = context;
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle0", timeout: 20_000 });

    await loadAllCards(page, SPECS.length);
    expect(await countCards(page)).toBeGreaterThanOrEqual(SPECS.length);

    for (let i = 0; i < SPECS.length; i++) {
      await ensureNthOpen(page, i);

      // Starts collapsed with a finite max-height.
      const initial = await readNthState(page, i);
      expect(initial).not.toBeNull();
      expect(initial!.collapsed).toBe(true);
      expect(initial!.expanded).toBe(false);
      expect(initial!.maxHeight).not.toBe("none");

      // Clicking the bar expands it (max-height released).
      const expanded = await clickNthToggle(page, i);
      expect(expanded).not.toBeNull();
      expect(expanded!.expanded).toBe(true);
      expect(expanded!.collapsed).toBe(false);
      expect(expanded!.maxHeight).toBe("none");

      // Clicking again collapses it back.
      const recollapsed = await clickNthToggle(page, i);
      expect(recollapsed!.collapsed).toBe(true);
      expect(recollapsed!.expanded).toBe(false);
      expect(recollapsed!.maxHeight).not.toBe("none");
    }
  }, 120_000);

  it("keeps every block independently toggleable once all are loaded", async () => {
    const { page } = context;
    // Expand all blocks; with the bug, later blocks (more code blocks present)
    // would no longer respond.
    for (let i = 0; i < SPECS.length; i++) {
      const s = await clickNthToggle(page, i);
      expect(s!.expanded).toBe(true);
    }
    // All ten remain expanded simultaneously.
    for (let i = 0; i < SPECS.length; i++) {
      const s = await readNthState(page, i);
      expect(s!.expanded).toBe(true);
    }
    // The first and last are still interactive after many blocks exist.
    expect((await clickNthToggle(page, 0))!.collapsed).toBe(true);
    expect((await clickNthToggle(page, SPECS.length - 1))!.collapsed).toBe(true);
  }, 60_000);

  it("expand still works and does not flicker back after editing the article", async () => {
    const { page, baseUrl } = context;

    await loginAsAdmin(context);
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle0", timeout: 20_000 });
    await loadAllCards(page, 1);
    await ensureNthOpen(page, 0);

    // Expand the first article's code block before editing.
    const pre = await clickNthToggle(page, 0);
    expect(pre!.expanded).toBe(true);

    // Open the editor for the first card, change the title, and save.
    await page.evaluate(() => {
      const card = document.querySelector('[data-testid="article-card"]');
      const btn = card?.querySelector(
        'button[title="Edit article"]',
      ) as HTMLButtonElement | null;
      btn?.click();
    });
    const titleInput = await page.waitForSelector('input[placeholder="Title"]', {
      timeout: 10_000,
    });
    const newTitle = `Edited Code Article ${Date.now()}`;
    await titleInput!.click({ clickCount: 3 });
    await page.keyboard.press("Backspace");
    await page.keyboard.type(newTitle);

    await page.evaluate(() => {
      const btn = Array.from(
        document.querySelectorAll('button[type="submit"]'),
      ).find((b) => /Update/i.test(b.textContent || ""));
      (btn as HTMLButtonElement | undefined)?.click();
    });

    // Wait for the modal to close and the edited title to appear in the feed.
    await page.waitForFunction(
      (t: string) => {
        const modalGone = !document.querySelector('input[placeholder="Title"]');
        const hasTitle = Array.from(
          document.querySelectorAll('[data-testid="article-card"] h2'),
        ).some((h) => h.textContent?.includes(t));
        return modalGone && hasTitle;
      },
      { timeout: 20_000 },
      newTitle,
    );

    // The edited article is still first; its body should reflect the update and
    // its code block must expand AND stay expanded (no flicker to collapsed).
    await ensureNthOpen(page, 0);
    const afterEdit = await clickNthToggle(page, 0);
    expect(afterEdit).not.toBeNull();
    expect(afterEdit!.expanded).toBe(true);

    // Give any delayed re-render a chance to fight the expanded state.
    await new Promise((r) => setTimeout(r, 1500));
    const settled = await readNthState(page, 0);
    expect(settled!.expanded).toBe(true);
    expect(settled!.collapsed).toBe(false);
    expect(settled!.maxHeight).toBe("none");
  }, 90_000);

  it("produced no uncaught page errors or code-block console errors", async () => {
    expect(pageErrors).toEqual([]);
    const relevant = consoleErrors.filter((m) =>
      /cb-code|hljs|highlight|toggle|collapse/i.test(m),
    );
    expect(relevant).toEqual([]);
  }, 10_000);
});
