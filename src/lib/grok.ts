/**
 * Grok (x.ai) translation coordinator.
 *
 * Article bodies are stored as HTML but translated as Markdown: Markdown is the
 * reduced, element-addressable representation that the existing WYSIWYG round-
 * trip (turndown / marked) already preserves losslessly, so the model translates
 * prose while code fences, embeds (`@[label](url)`), image/link targets, and the
 * `--END PREVIEW--` marker survive intact.
 *
 * Resolution is a two-tier read-through (cache -> database -> Grok) mirroring
 * lib/cache.ts. Translations are a pure function of an article revision, so they
 * are safely memoizable but MUST be evicted when the source changes (handled in
 * lib/articles.ts on update/delete).
 */
import { marked } from "marked";
import TurndownService from "turndown";
import { env, grokConfigured } from "@/lib/env";
import { getPrisma } from "@/lib/prisma";
import { remember, invalidate } from "@/lib/cache";
import {
  registerEmbedExtension,
  addEmbedTurndownRule,
} from "@/lib/embeds";
import { localeLabel, type Locale } from "@/lib/i18n";
import { createLogger } from "@/lib/logger";

export { grokConfigured };

const log = createLogger("grok");

// Enable the `@[name](url)` / sized-image / preview-separator markdown grammar
// on the shared marked instance (idempotent).
registerEmbedExtension(marked);

/** Reduce article HTML to canonical, translation-safe Markdown. */
export function htmlToTranslatableMarkdown(html: string): string {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  });
  addEmbedTurndownRule(turndown);
  return turndown.turndown(html);
}

/** Expand (translated) Markdown back into article-body HTML. */
export function markdownToHtml(markdown: string): string {
  return marked.parse(markdown) as string;
}

/**
 * Substitute the supported placeholders in a prompt template. Unknown
 * placeholders are left untouched so custom templates fail visibly rather than
 * silently dropping text.
 */
export function fillPromptTemplate(
  template: string,
  vars: {
    sourceLocale: string;
    targetLocale: string;
    sourceLang: string;
    targetLang: string;
    content: string;
  },
): string {
  return template
    .replaceAll("{sourceLocale}", vars.sourceLocale)
    .replaceAll("{targetLocale}", vars.targetLocale)
    .replaceAll("{sourceLang}", vars.sourceLang)
    .replaceAll("{targetLang}", vars.targetLang)
    .replaceAll("{content}", vars.content);
}

function promptVars(content: string, sourceLocale: string, targetLocale: string) {
  return {
    sourceLocale,
    targetLocale,
    sourceLang: localeLabel(sourceLocale),
    targetLang: localeLabel(targetLocale),
    content,
  };
}

export function buildTranslationPrompt(
  contentMarkdown: string,
  sourceLocale: string,
  targetLocale: string,
): string {
  return fillPromptTemplate(
    env.GROK_TRANSLATION_PROMPT,
    promptVars(contentMarkdown, sourceLocale, targetLocale),
  );
}

export function buildTitlePrompt(
  title: string,
  sourceLocale: string,
  targetLocale: string,
): string {
  return fillPromptTemplate(
    env.GROK_TITLE_PROMPT,
    promptVars(title, sourceLocale, targetLocale),
  );
}

/** A function that maps a prompt to Grok's completion text. Injectable for tests. */
export type CompletionFn = (prompt: string) => Promise<string>;

/**
 * Call the Grok chat-completions endpoint and return the message content.
 * Uses the OpenAI-compatible schema exposed by the x.ai API.
 */
export const callGrok: CompletionFn = async (prompt: string): Promise<string> => {
  if (!grokConfigured()) throw new Error("Grok is not configured");
  const url = `${env.GROK_BASE_URL.replace(/\/$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.GROK_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.GROK_MODEL,
      temperature: env.GROK_TEMPERATURE,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    // Surface the upstream detail so misconfiguration is diagnosable. A 400 is
    // most commonly an invalid/inaccessible GROK_MODEL (e.g. the deprecated
    // "grok-2-latest"); 401/403 indicate a bad/expired GROK_API_KEY.
    const detail = await res.text().catch(() => "");
    const hint =
      res.status === 400
        ? " (check GROK_MODEL — 'grok-2-latest' is deprecated; try 'grok-4.3')"
        : res.status === 401 || res.status === 403
          ? " (check GROK_API_KEY)"
          : "";
    throw new Error(
      `Grok API error ${res.status} ${res.statusText}${hint}${detail ? `: ${detail.slice(0, 500)}` : ""}`,
    );
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new Error("Grok API returned an empty completion");
  }
  return content;
};

export interface TranslateBodyInput {
  title: string;
  contentHtml: string;
  sourceLocale: string;
  targetLocale: string;
  /** Override the completion backend (defaults to the live Grok call). */
  complete?: CompletionFn;
}

/**
 * Translate a single article's title + body. Pure with respect to storage: it
 * only performs the HTML->Markdown->translate->HTML transformation. Persistence
 * and caching are layered on by `translateArticle`.
 */
export async function translateArticleBody(
  input: TranslateBodyInput,
): Promise<{ title: string; content: string }> {
  const complete = input.complete ?? callGrok;
  const markdown = htmlToTranslatableMarkdown(input.contentHtml);

  const [translatedMarkdown, translatedTitle] = await Promise.all([
    complete(buildTranslationPrompt(markdown, input.sourceLocale, input.targetLocale)),
    complete(buildTitlePrompt(input.title, input.sourceLocale, input.targetLocale)),
  ]);

  return {
    title: translatedTitle.trim() || input.title,
    content: markdownToHtml(translatedMarkdown),
  };
}

export interface ArticleTranslationResult {
  locale: string;
  title: string;
  content: string;
}

const cacheKey = (articleId: string, locale: string) => `${articleId}:${locale}`;

/**
 * Resolve a translation for (articleId, targetLocale) through the read-through
 * chain: translation cache -> ArticleTranslation row -> Grok. On a Grok miss
 * the result is persisted (durable) and cached (hot). If the target locale
 * equals the source, the original is returned unchanged (no API call).
 */
export async function translateArticle(opts: {
  articleId: string;
  targetLocale: Locale;
  title: string;
  contentHtml: string;
  sourceLocale: string;
  complete?: CompletionFn;
}): Promise<ArticleTranslationResult> {
  const { articleId, targetLocale, sourceLocale } = opts;

  if (targetLocale === sourceLocale) {
    return { locale: targetLocale, title: opts.title, content: opts.contentHtml };
  }

  return remember<ArticleTranslationResult>(
    "translation",
    cacheKey(articleId, targetLocale),
    async () => {
      const prisma = getPrisma();

      // Durable tier: reuse a previously persisted translation if present.
      const existing = await prisma.articleTranslation.findUnique({
        where: { articleId_locale: { articleId, locale: targetLocale } },
      });
      if (existing) {
        return { locale: targetLocale, title: existing.title, content: existing.content };
      }

      // Miss: translate via Grok, then persist write-through (DB first).
      const translated = await translateArticleBody({
        title: opts.title,
        contentHtml: opts.contentHtml,
        sourceLocale,
        targetLocale,
        complete: opts.complete,
      });

      await prisma.articleTranslation.upsert({
        where: { articleId_locale: { articleId, locale: targetLocale } },
        update: { title: translated.title, content: translated.content, sourceLocale },
        create: {
          articleId,
          locale: targetLocale,
          sourceLocale,
          title: translated.title,
          content: translated.content,
        },
      });

      return { locale: targetLocale, title: translated.title, content: translated.content };
    },
  );
}

/**
 * Drop all cached + persisted translations for an article. Called from
 * lib/articles.ts whenever the source article changes or is deleted so a stale
 * revision is never served (the DB rows also cascade-delete with the article).
 */
export async function invalidateArticleTranslations(articleId: string): Promise<void> {
  try {
    await getPrisma().articleTranslation.deleteMany({ where: { articleId } });
  } catch (err) {
    log.warn("failed to delete translations for", articleId, err);
  }
  // Cache keys are `${articleId}:${locale}`; clearing the whole category is the
  // simplest correct eviction given the KV helper's prefix granularity.
  await invalidate("translation");
}
