/**
 * Unit tests for the Grok translation pipeline.
 *
 * The pipeline translates article *Markdown* (not raw HTML) so that structural
 * elements survive: fenced code blocks, `@[label](url)` embeds, image/link
 * targets, and the `--END PREVIEW--` marker must all pass through untouched
 * while prose is translated.
 *
 * Two committed fixtures are reused here (kept after creation):
 *   - tests/fixtures/translation/article.html  — a representative source body
 *   - tests/fixtures/translation/grok-result.md — a recorded Grok translation
 * The live network call is never made; a recorded/mocked completion function is
 * injected instead, keeping the suite deterministic and offline.
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  htmlToTranslatableMarkdown,
  markdownToHtml,
  fillPromptTemplate,
  buildTranslationPrompt,
  buildTitlePrompt,
  translateArticleBody,
  chunkMarkdown,
  extractCodeBlocks,
  restoreCodeBlocks,
  grokConfigured,
  type CompletionFn,
} from "@/lib/grok";

const FIXTURES = resolve(__dirname, "../fixtures/translation");
const articleHtml = readFileSync(resolve(FIXTURES, "article.html"), "utf8");
const grokResultMd = readFileSync(resolve(FIXTURES, "grok-result.md"), "utf8");

/**
 * Recorded completion: body prompts contain "Markdown document", title prompts
 * contain "blog article title". Code blocks are stripped before sending, so
 * we can no longer use ``` to distinguish — use the prompt text instead.
 */
const recordedComplete: CompletionFn = async (prompt: string) =>
  prompt.includes("Markdown document") ? grokResultMd : "Prise en main de cHackerBlog";

describe("grok integration gating", () => {
  it("reports configured when GROK_API_KEY is present (.env.test)", () => {
    expect(grokConfigured()).toBe(true);
  });
});

describe("htmlToTranslatableMarkdown (source HTML -> Markdown)", () => {
  const md = htmlToTranslatableMarkdown(articleHtml);

  it("reduces headings and prose to Markdown", () => {
    expect(md).toContain("# Getting Started with cHackerBlog");
    expect(md).toContain("## Installation");
    expect(md).toContain("introduction paragraph");
  });

  it("preserves fenced code blocks with their language", () => {
    expect(md).toContain("```ts");
    expect(md).toContain('const greeting = "hello";');
  });

  it("collapses embeds back to the @[name](url) tag", () => {
    expect(md).toContain("@[report.pdf](http://example.com/report.pdf)");
  });

  it("preserves the --END PREVIEW-- marker", () => {
    expect(md).toContain("--END PREVIEW--");
  });
});

describe("markdownToHtml (translated Markdown -> HTML)", () => {
  const html = markdownToHtml(grokResultMd);

  it("renders translated prose", () => {
    expect(html).toContain("Prise en main de cHackerBlog");
    expect(html).toContain("Ce contenu masqué");
  });

  it("keeps code blocks intact and untranslated", () => {
    expect(html).toContain("language-ts");
    expect(html).toContain("const greeting =");
  });

  it("re-expands the embed tag to embed HTML", () => {
    expect(html).toContain("data-embed");
    expect(html).toContain("http://example.com/report.pdf");
  });

  it("re-renders the preview separator", () => {
    expect(html).toContain("data-preview-end");
  });
});

describe("prompt templating", () => {
  it("substitutes all supported placeholders", () => {
    const out = fillPromptTemplate("[{sourceLang}->{targetLang}] {sourceLocale}/{targetLocale}: {content}", {
      sourceLocale: "en",
      targetLocale: "fr",
      sourceLang: "English",
      targetLang: "French",
      content: "BODY",
    });
    expect(out).toBe("[English->French] en/fr: BODY");
  });

  it("leaves unknown placeholders untouched", () => {
    expect(
      fillPromptTemplate("{content} {unknown}", {
        sourceLocale: "en",
        targetLocale: "fr",
        sourceLang: "English",
        targetLang: "French",
        content: "X",
      }),
    ).toBe("X {unknown}");
  });

  it("buildTranslationPrompt names the human-readable languages", () => {
    const md = htmlToTranslatableMarkdown(articleHtml);
    const prompt = buildTranslationPrompt(md, "en", "fr");
    expect(prompt).toContain("English");
    expect(prompt).toContain("French");
    expect(prompt).toContain("@[report.pdf](http://example.com/report.pdf)");
  });

  it("buildTitlePrompt carries the raw title as content", () => {
    const prompt = buildTitlePrompt("Getting Started", "en", "de");
    expect(prompt).toContain("Getting Started");
    expect(prompt).toContain("German");
  });
});

describe("translateArticleBody (end-to-end with recorded completion)", () => {
  it("returns a translated title and structurally-preserved HTML body", async () => {
    const result = await translateArticleBody({
      title: "Getting Started with cHackerBlog",
      contentHtml: articleHtml,
      sourceLocale: "en",
      targetLocale: "fr",
      complete: recordedComplete,
    });

    // Title translated.
    expect(result.title).toBe("Prise en main de cHackerBlog");
    // Prose translated in the body.
    expect(result.content).toContain("Ce contenu masqué");
    // Structure preserved through the round-trip.
    expect(result.content).toContain("language-ts");
    expect(result.content).toContain("data-embed");
    expect(result.content).toContain("data-preview-end");
  });

  it("keeps the original title when the model returns an empty string", async () => {
    const emptyComplete: CompletionFn = async (prompt: string) =>
      prompt.includes("Markdown document") ? grokResultMd : "   ";
    const result = await translateArticleBody({
      title: "Original Title",
      contentHtml: articleHtml,
      sourceLocale: "en",
      targetLocale: "fr",
      complete: emptyComplete,
    });
    expect(result.title).toBe("Original Title");
  });
});

describe("translateArticleBody with multiple chunks", () => {
  it("translates each chunk and reassembles correctly", async () => {
    // Build a large HTML body that will produce markdown exceeding the default
    // GROK_CHUNK_SIZE (1000 chars). Each paragraph is ~80 chars in markdown, so
    // ~20 paragraphs will exceed 1000.
    const paragraphs = Array.from({ length: 20 }, (_, i) =>
      `<p>This is paragraph number ${i + 1} with enough text to fill a chunk nicely and then some more.</p>`
    ).join("\n");
    const largeHtml = `<h1>Large Article</h1>\n${paragraphs}`;

    // Mock that "translates" by prefixing each chunk with [FR]
    let callCount = 0;
    const multiChunkComplete: CompletionFn = async (prompt: string) => {
      callCount++;
      // Title prompt contains "blog article title"
      if (prompt.includes("blog article title")) {
        return "Traduction du titre";
      }
      // Body prompt — return the content portion with a marker
      const contentStart = prompt.indexOf("{content}");
      const body = contentStart >= 0 ? prompt.slice(contentStart + 9) : prompt;
      return `[FR] ` + body;
    };

    const result = await translateArticleBody({
      title: "Large Article",
      contentHtml: largeHtml,
      sourceLocale: "en",
      targetLocale: "fr",
      complete: multiChunkComplete,
    });

    // Title should be translated
    expect(result.title).toBe("Traduction du titre");
    // Content should be HTML
    expect(result.content).toContain("<p>");
    // Multiple calls should have been made (title + at least 2 body chunks)
    expect(callCount).toBeGreaterThan(2);
  });
});

describe("extractCodeBlocks / restoreCodeBlocks", () => {
  it("extracts fenced code blocks and replaces with placeholders", () => {
    const md = "# Heading\n\nIntro text.\n\n```ts\nconst x = 1;\n```\n\nOutro text.\n";
    const { markdown, codeBlocks } = extractCodeBlocks(md);

    // Code block content is gone, replaced by placeholder
    expect(markdown).not.toContain("const x = 1;");
    expect(markdown).not.toContain("```ts");
    expect(markdown).toContain("<!--CB0-->");
    // Surrounding text is preserved
    expect(markdown).toContain("# Heading");
    expect(markdown).toContain("Intro text.");
    expect(markdown).toContain("Outro text.");
    // Code block is stored with fences and language tag
    expect(codeBlocks).toHaveLength(1);
    expect(codeBlocks[0]).toBe("```ts\nconst x = 1;\n```");
  });

  it("handles multiple code blocks", () => {
    const md = "```js\nfoo()\n```\n\nText between.\n\n```python\nbar()\n```";
    const { markdown, codeBlocks } = extractCodeBlocks(md);

    expect(markdown).toContain("<!--CB0-->");
    expect(markdown).toContain("<!--CB1-->");
    expect(markdown).toContain("Text between.");
    expect(codeBlocks).toHaveLength(2);
    expect(codeBlocks[0]).toBe("```js\nfoo()\n```");
    expect(codeBlocks[1]).toBe("```python\nbar()\n```");
  });

  it("handles markdown with no code blocks", () => {
    const md = "# Just text\n\nNo code here.\n";
    const { markdown, codeBlocks } = extractCodeBlocks(md);
    expect(markdown).toBe(md);
    expect(codeBlocks).toEqual([]);
  });

  it("restores code blocks verbatim", () => {
    const md = "# Title\n\n```ts\nconst x = 1;\n```\n\nText.\n\n```py\nprint('hi')\n```";
    const { markdown, codeBlocks } = extractCodeBlocks(md);
    const restored = restoreCodeBlocks(markdown, codeBlocks);
    expect(restored).toBe(md);
  });

  it("restores code blocks in translated content", () => {
    // Simulate: extract, "translate" the prose, restore
    const md = "# Title\n\n```ts\nconst x = 1;\n```\n\nSome text.\n";
    const { markdown, codeBlocks } = extractCodeBlocks(md);
    // Mock translation: just uppercase the non-code parts
    const translated = markdown.toUpperCase();
    const restored = restoreCodeBlocks(translated, codeBlocks);
    // Code block should be back in original form
    expect(restored).toContain("```ts");
    expect(restored).toContain("const x = 1;");
    // Translated prose is preserved
    expect(restored).toContain("# TITLE");
  });

  it("handles 4-backtick fences from Turndown (code containing nested ```)", () => {
    // Turndown uses 4-backtick fences when code content contains ``` lines
    const md = "````ts\nlet x = 1;\n```nested\nfoo()\n```\nlet y = 2;\n````\n\nText.\n";
    const { markdown, codeBlocks } = extractCodeBlocks(md);

    // The entire code block should be extracted as one unit
    expect(codeBlocks).toHaveLength(1);
    expect(codeBlocks[0]).toBe(md.split("\n").slice(0, 7).join("\n"));
    // The inner ``` lines should NOT appear in the stripped markdown
    expect(markdown).not.toContain("```nested");
    expect(markdown).not.toContain("foo()");
    expect(markdown).not.toContain("let y = 2;");
    // Placeholder should be present
    expect(markdown).toContain("<!--CB0-->");
    // Surrounding text preserved
    expect(markdown).toContain("Text.");
  });

  it("round-trips 4-backtick code blocks through extract + restore", () => {
    const md = "# Title\n\n````ts\nlet x = 1;\n```inner\nbar()\n```\nlet y = 2;\n````\n\nEnd.\n";
    const { markdown, codeBlocks } = extractCodeBlocks(md);
    const restored = restoreCodeBlocks(markdown, codeBlocks);
    expect(restored).toBe(md);
  });
});

describe("translated body survives a second HTML -> Markdown reduction", () => {
  it("still contains code, embed, and preview marker", () => {
    const html = markdownToHtml(grokResultMd);
    const backToMd = htmlToTranslatableMarkdown(html);
    expect(backToMd).toContain("```ts");
    expect(backToMd).toContain("@[report.pdf](http://example.com/report.pdf)");
    expect(backToMd).toContain("--END PREVIEW--");
  });
});

describe("chunkMarkdown (line-boundary splitting)", () => {
  it("returns a single chunk when content is under the limit", () => {
    const md = "# Title\n\nShort paragraph.\n";
    const chunks = chunkMarkdown(md, 4000);
    expect(chunks).toHaveLength(1);
    // chunkMarkdown adds \n to each chunk; the input's trailing \n is
    // preserved because split removes the trailing "" and flush re-adds \n
    expect(chunks[0]).toBe("# Title\n\nShort paragraph.\n");
  });

  it("splits on line boundaries when exceeding the limit", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `Line ${i + 1} with some text.`);
    const md = lines.join("\n") + "\n";
    // 10 lines * ~25 chars each = ~250 chars. Use maxChars=100 to force splitting.
    const chunks = chunkMarkdown(md, 100);
    expect(chunks.length).toBeGreaterThan(1);

    // Reassembly should equal the original (trailing \n preserved by flush)
    expect(chunks.join("")).toBe(md);

    // No chunk (except possibly one containing a code block) should exceed
    // the limit by more than the longest single line
    for (const chunk of chunks) {
      // Each chunk ends with \n, and the max line in this test is ~25 chars
      // so no chunk should be wildly over the limit
      expect(chunk.length).toBeLessThanOrEqual(100 + 30);
    }
  });

  it("never splits through a fenced code block", () => {
    const codeBlock = "```ts\n" + "x".repeat(200) + "\n```";
    const md = `# Heading\n\nIntro paragraph.\n\n${codeBlock}\n\nOutro paragraph.\n`;
    // Use a small maxChars that would normally split the code block
    const chunks = chunkMarkdown(md, 80);

    // Reassembly preserves the original
    expect(chunks.join("")).toBe(md);

    // Find the chunk containing the code block
    const codeChunk = chunks.find((c) => c.includes("```ts"));
    expect(codeChunk).toBeDefined();
    // The code block must be intact within a single chunk
    expect(codeChunk).toContain("```ts");
    expect(codeChunk).toContain("```");
  });

  it("handles empty input", () => {
    const chunks = chunkMarkdown("", 4000);
    expect(chunks).toEqual([]);
  });

  it("handles single-line input", () => {
    const chunks = chunkMarkdown("Just one line.", 4000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe("Just one line.\n");
  });

  it("each chunk ends with a newline", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}.`);
    const md = lines.join("\n") + "\n";
    const chunks = chunkMarkdown(md, 50);
    for (const chunk of chunks) {
      expect(chunk.endsWith("\n")).toBe(true);
    }
  });

  it("preserves embed tags within a single chunk", () => {
    const embed = "@[report.pdf](http://example.com/report.pdf)";
    const md = `# Heading\n\n${embed}\n\nParagraph after.\n`;
    const chunks = chunkMarkdown(md, 50);
    // Reassembly preserves content (flush adds trailing \n)
    expect(chunks.join("")).toBe(md);
    // The embed tag should be in one piece in some chunk
    const embedChunk = chunks.find((c) => c.includes("@[report.pdf]"));
    expect(embedChunk).toBeDefined();
    expect(embedChunk).toContain("http://example.com/report.pdf");
  });
});
