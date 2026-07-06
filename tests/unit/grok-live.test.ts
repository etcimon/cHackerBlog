/**
 * Live Grok API translation test — NOT part of the regular test suite.
 *
 * This test calls the real Grok (x.ai) API using the key from `.env` (not
 * `.env.test`). It translates the "AI Slop" article which contains large code
 * blocks with size/preview info strings, an image embed, and the --END PREVIEW--
 * marker — the exact scenario that was pruning code blocks before the
 * fence-length-aware fix.
 *
 * Run with:
 *   $env:GROK_LIVE_TEST=1; bun test tests/unit/grok-live.test.ts
 *
 * The test is gated: it skips automatically unless GROK_LIVE_TEST=1 is set in
 * the environment, so it never fires during `bun test` or CI.
 */
import { config } from "dotenv";
import { readFileSync } from "fs";
import { resolve } from "path";
import { env } from "@/lib/env";
import {
  htmlToTranslatableMarkdown,
  markdownToHtml,
  translateArticleBody,
  extractCodeBlocks,
  grokConfigured,
} from "@/lib/grok";

// Bun test auto-loads .env.test which overrides GROK_MODEL to grok-2-latest
// and GROK_API_KEY to a test fixture. We must re-load .env with override:true
// and patch the env singleton (already evaluated at import time) with the
// real values.
config({ path: ".env", override: true });
env.GROK_API_KEY = process.env.GROK_API_KEY!;
env.GROK_MODEL = process.env.GROK_MODEL!;
env.GROK_BASE_URL = process.env.GROK_BASE_URL!;
env.GROK_TEMPERATURE = Number(process.env.GROK_TEMPERATURE);

const FIXTURES = resolve(__dirname, "../fixtures/translation");
const articleMd = readFileSync(resolve(FIXTURES, "ai-slop-article.md"), "utf8");

const LIVE = process.env.GROK_LIVE_TEST === "1" || process.env.GROK_LIVE_TEST === "true";

// Use a conditional describe so the test is skipped in normal runs.
const maybeDescribe = LIVE ? describe : describe.skip;

maybeDescribe("Live Grok translation — AI Slop article (real API)", () => {
  if (!LIVE && !grokConfigured()) {
    // Will be skipped by describe.skip, but log for clarity.
    console.log("[grok-live] Skipped — set GROK_LIVE_TEST=1 to run against the live API.");
  }

  // Pre-compute the HTML representation (articles are stored as HTML).
  const articleHtml = markdownToHtml(articleMd);

  // Translate to Spanish as a representative locale.
  // The article has many chunks at 500 chars, so each test needs a long timeout.
  // Bun test default timeout is 5s; override with { timeout: 120000 } per test.

  it("translates the article without pruning code blocks", async () => {
    expect(grokConfigured()).toBe(true);

    const result = await translateArticleBody({
      title: "When AI Slop Meets the Unit Test",
      contentHtml: articleHtml,
      sourceLocale: "en",
      targetLocale: "es",
    });

    // Title should be translated (non-empty, different from source).
    expect(result.title).toBeTruthy();
    expect(result.title).not.toBe("When AI Slop Meets the Unit Test");

    // The translated content should be valid HTML.
    expect(result.content).toContain("<");

    // Convert back to markdown to inspect structure.
    const translatedMd = htmlToTranslatableMarkdown(result.content);

    // --END PREVIEW-- marker must survive.
    expect(translatedMd).toContain("--END PREVIEW--");

    // Code blocks must be present and intact — check for distinctive snippets
    // from each of the 4 code blocks in the source article.
    const { codeBlocks } = extractCodeBlocks(translatedMd);

    // Should have the same number of code blocks as the source (4).
    const sourceExtracted = extractCodeBlocks(htmlToTranslatableMarkdown(articleHtml));
    expect(codeBlocks.length).toBe(sourceExtracted.codeBlocks.length);

    // Each code block should contain its distinctive function/identifier.
    // Block 1: parseSizeSpec state machine
    expect(codeBlocks[0]).toContain("parseSizeSpec");
    expect(codeBlocks[0]).toContain("EmbedSize");
    expect(codeBlocks[0]).toContain("named_after_value");

    // Block 2: unit test snippets
    expect(codeBlocks[1]).toContain("buildImageMarkdown");
    expect(codeBlocks[1]).toContain("buildImageHtml");
    expect(codeBlocks[1]).toContain("data-cb-img");

    // Block 3: architecture prompt
    expect(codeBlocks[2]).toContain("logisplain");
    expect(codeBlocks[2]).toContain("urlOnly");

    // Block 4: README embed documentation
    expect(codeBlocks[3]).toContain("youtube");
    expect(codeBlocks[3]).toContain("SoundCloud");

    // No code block should be truncated (each should end with a closing fence).
    for (let i = 0; i < codeBlocks.length; i++) {
      expect(codeBlocks[i].endsWith("```")).toBe(true);
      // Log sizes for manual inspection.
      console.log(`[grok-live] Code block ${i + 1}: ${codeBlocks[i].length} chars (source: ${sourceExtracted.codeBlocks[i].length} chars)`);
    }

    // Embeds should survive: the image and the YouTube/SoundCloud links.
    expect(translatedMd).toContain("@[](https://www.youtube.com/watch?v=Z_UOmAed5O8)");
    expect(translatedMd).toContain("@[](https://soundcloud.com/artist/track)");

    // The Devin link should survive untranslated.
    expect(translatedMd).toContain("https://devin.ai");

    // The GitHub repo link should survive.
    expect(translatedMd).toContain("https://github.com/etcimon/cHackerBlog");
  }, 120_000);

  it("preserves code block languages through the translation pipeline", async () => {
    expect(grokConfigured()).toBe(true);

    const result = await translateArticleBody({
      title: "When AI Slop Meets the Unit Test",
      contentHtml: articleHtml,
      sourceLocale: "en",
      targetLocale: "fr",
    });

    const translatedMd = htmlToTranslatableMarkdown(result.content);
    const { codeBlocks } = extractCodeBlocks(translatedMd);

    // The grok.ts marked renderer creates simple <pre><code class="lang"> elements
    // (no .cb-code wrapper), so turndown reconstructs the fence with just the
    // language. Size/preview metadata is lost in the HTML round-trip but the
    // code content and language are preserved verbatim.
    expect(codeBlocks.length).toBe(4);

    // Block 1: parseSizeSpec state machine — language ts.
    expect(codeBlocks[0]).toMatch(/^```ts\b/);
    expect(codeBlocks[0]).toContain("parseSizeSpec");

    // Block 2: unit test snippets — language ts.
    expect(codeBlocks[1]).toMatch(/^```ts\b/);
    expect(codeBlocks[1]).toContain("buildImageMarkdown");

    // Blocks 3 & 4: plaintext blocks.
    expect(codeBlocks[2]).toMatch(/^```plaintext\b/);
    expect(codeBlocks[2]).toContain("logisplain");

    expect(codeBlocks[3]).toMatch(/^```plaintext\b/);
    expect(codeBlocks[3]).toContain("youtube");

    // All code blocks should end with a closing fence (not truncated).
    for (const cb of codeBlocks) {
      expect(cb.endsWith("```")).toBe(true);
    }
  }, 120_000);
});
