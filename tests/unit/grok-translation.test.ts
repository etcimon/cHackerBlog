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
  grokConfigured,
  type CompletionFn,
} from "@/lib/grok";

const FIXTURES = resolve(__dirname, "../fixtures/translation");
const articleHtml = readFileSync(resolve(FIXTURES, "article.html"), "utf8");
const grokResultMd = readFileSync(resolve(FIXTURES, "grok-result.md"), "utf8");

/** Recorded completion: body prompts contain a code fence, title prompts do not. */
const recordedComplete: CompletionFn = async (prompt: string) =>
  prompt.includes("```") ? grokResultMd : "Prise en main de cHackerBlog";

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
      prompt.includes("```") ? grokResultMd : "   ";
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

describe("translated body survives a second HTML -> Markdown reduction", () => {
  it("still contains code, embed, and preview marker", () => {
    const html = markdownToHtml(grokResultMd);
    const backToMd = htmlToTranslatableMarkdown(html);
    expect(backToMd).toContain("```ts");
    expect(backToMd).toContain("@[report.pdf](http://example.com/report.pdf)");
    expect(backToMd).toContain("--END PREVIEW--");
  });
});
