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
import { remember, invalidate, invalidateByPrefix, get, set } from "@/lib/cache";
import {
  registerEmbedExtension,
  addEmbedTurndownRule,
} from "@/lib/embeds";
import { localeLabel, type Locale } from "@/lib/i18n";
import { createLogger } from "@/lib/logger";

export { grokConfigured };

const log = createLogger("grok");

/**
 * Get the current UTC date as a string (YYYY-MM-DD) for rate limit key.
 */
function getUtcDateKey(): string {
  const now = new Date();
  return now.toISOString().split('T')[0]; // YYYY-MM-DD
}

/**
 * Check and increment the global Grok API rate limit.
 * Throws an error if the limit is exceeded.
 */
async function checkGlobalRateLimit(): Promise<void> {
  const dateKey = getUtcDateKey();
  const cacheKey = `grok:rate-limit:${dateKey}`;

  const current = await get<number>("grok-rate-limit", cacheKey);
  const count = current ?? 0;

  if (count >= env.GROK_RATE_LIMIT_DAY) {
    throw new Error(`Grok API rate limit exceeded: maximum ${env.GROK_RATE_LIMIT_DAY} calls per day`);
  }

  // Increment the counter
  await set("grok-rate-limit", cacheKey, count + 1, 86400); // TTL 24 hours
}

// Enable the `@[name](url)` / sized-image / preview-separator markdown grammar
// on the shared marked instance (idempotent).
registerEmbedExtension(marked);

// Configure marked to preserve language classes in code blocks
marked.use({
  renderer: {
    code(code: string, language: string | undefined) {
      const lang = language ? ` class="language-${language}"` : "";
      return `<pre><code${lang}>${code}</code></pre>`;
    },
  },
});

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
 * Extract fenced code blocks from Markdown, replacing each with a short
 * placeholder comment (`<!--CB0-->`, `<!--CB1-->`, …). This prevents the code
 * contents from being sent to the translation model (saving tokens and avoiding
 * accidental alteration), while keeping the structural position so the block
 * can be restored verbatim after translation.
 *
 * Handles fences of any length (3+ backticks). Turndown uses 4+ backtick
 * fences when code content contains ``` lines, so we must only close on a
 * fence with >= backticks than the opening fence.
 *
 * Returns the stripped Markdown and an ordered array of the original code
 * blocks (including their ``` fences and language tags).
 */
export function extractCodeBlocks(
  markdown: string,
): { markdown: string; codeBlocks: string[] } {
  const codeBlocks: string[] = [];
  const lines = markdown.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const openMatch = line.trim().match(/^(`{3,})/);
    if (openMatch) {
      // Start of a fenced code block — collect until a closing fence with
      // at least as many backticks as the opening fence.
      const fenceLen = openMatch[1].length;
      const block: string[] = [line];
      i++;
      while (i < lines.length) {
        const closeMatch = lines[i]!.trim().match(/^(`{3,})$/);
        if (closeMatch && closeMatch[1].length >= fenceLen) break;
        block.push(lines[i]!);
        i++;
      }
      // Include the closing fence if present
      if (i < lines.length) {
        block.push(lines[i]!);
        i++;
      }
      const placeholder = `<!--CB${codeBlocks.length}-->`;
      codeBlocks.push(block.join("\n"));
      out.push(placeholder);
    } else {
      out.push(line);
      i++;
    }
  }

  return { markdown: out.join("\n"), codeBlocks };
}

/**
 * Restore code block placeholders (`<!--CB0-->`, …) back to the original
 * fenced code blocks. Inverse of `extractCodeBlocks`.
 */
export function restoreCodeBlocks(
  markdown: string,
  codeBlocks: string[],
): string {
  return markdown.replace(/<!--CB(\d+)-->/g, (_, idx: string) => {
    const i = parseInt(idx, 10);
    return codeBlocks[i] ?? `<!--CB${idx}-->`;
  });
}

/**
 * Split Markdown into chunks for translation, each no larger than `maxChars`.
 * Splitting happens on line boundaries only — never through a line, and never
 * through a fenced code block. If a single code block exceeds `maxChars`, it
 * gets its own chunk (oversized but intact).
 *
 * Handles fences of any length (3+ backticks). Turndown uses 4+ backtick
 * fences when code content contains ``` lines, so we must only close on a
 * fence with >= backticks than the opening fence.
 *
 * Returns an array of Markdown strings, each ending with a newline.
 */
export function chunkMarkdown(markdown: string, maxChars: number): string[] {
  if (markdown.length === 0) return [];

  const lines = markdown.split("\n");
  // If the input ends with \n, split produces a trailing "" — remove it
  // since flush already adds \n to each chunk.
  if (lines[lines.length - 1] === "") lines.pop();

  const chunks: string[] = [];
  let current: string[] = [];
  let currentLen = 0;
  let inCodeBlock = false;
  let codeFenceLen = 0;

  const flush = () => {
    if (current.length > 0) {
      chunks.push(current.join("\n") + "\n");
      current = [];
      currentLen = 0;
    }
  };

  for (const line of lines) {
    const lineLen = line.length + 1; // +1 for the \n
    const fenceMatch = line.trim().match(/^(`{3,})/);

    if (fenceMatch) {
      const fenceLen = fenceMatch[1].length;
      if (!inCodeBlock) {
        // Opening fence
        inCodeBlock = true;
        codeFenceLen = fenceLen;
        current.push(line);
        currentLen += lineLen;
        continue;
      } else if (fenceLen >= codeFenceLen) {
        // Closing fence (must have >= backticks than opening)
        inCodeBlock = false;
        codeFenceLen = 0;
        current.push(line);
        currentLen += lineLen;
        // Flush after the code block closes if we're over the limit
        if (currentLen >= maxChars) flush();
        continue;
      }
      // Inner fence with fewer backticks — treat as content, fall through
    }

    if (inCodeBlock) {
      current.push(line);
      currentLen += lineLen;
      continue;
    }

    // Outside code blocks: flush before starting a new chunk if this line
    // would push us over the limit.
    if (currentLen > 0 && currentLen + lineLen > maxChars) {
      flush();
    }

    current.push(line);
    currentLen += lineLen;
  }

  flush();
  return chunks;
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
 *
 * Enforces a global rate limit (GROK_RATE_LIMIT_DAY) before making the API call.
 */
export const callGrok: CompletionFn = async (prompt: string): Promise<string> => {
  if (!grokConfigured()) throw new Error("Grok is not configured");

  // Check global rate limit before making the API call
  await checkGlobalRateLimit();

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

  // Strip code blocks before translation: replace each with a short placeholder
  // so the model never sees code contents (saves tokens, prevents alteration).
  const { markdown: stripped, codeBlocks } = extractCodeBlocks(markdown);
  const chunks = chunkMarkdown(stripped, env.GROK_CHUNK_SIZE);

  log.info(
    "translateArticleBody: %d chunks (max %d chars each), %d code blocks extracted",
    chunks.length,
    env.GROK_CHUNK_SIZE,
    codeBlocks.length,
  );

  // Translate the title in parallel with the body chunks.
  const titlePromise = complete(
    buildTitlePrompt(input.title, input.sourceLocale, input.targetLocale),
  );

  // Translate body chunks sequentially to preserve context continuity.
  const translatedChunks: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    log.info("translating chunk %d/%d (%d chars)", i + 1, chunks.length, chunk.length);
    const prompt = buildTranslationPrompt(chunk, input.sourceLocale, input.targetLocale);
    const result = await complete(prompt);
    // Ensure each translated chunk ends with a newline for clean reassembly.
    translatedChunks.push(result.endsWith("\n") ? result : result + "\n");
  }

  const translatedMarkdown = restoreCodeBlocks(translatedChunks.join(""), codeBlocks);
  const translatedTitle = await titlePromise;

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
 *
 * Enforces a rate limit of 10 translations per day per article, reset when
 * the article is updated or deleted.
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

      // Check rate limit: 10 translations per day per article
      const article = await prisma.article.findUnique({
        where: { id: articleId },
        select: { translationCount: true, lastTranslationAt: true },
      });

      if (!article) {
        throw new Error("Article not found");
      }

      const now = new Date();
      const lastTranslation = article.lastTranslationAt ? new Date(article.lastTranslationAt) : null;
      const oneDayMs = 24 * 60 * 60 * 1000;

      // Reset count if it's a new day (more than 24 hours since last translation)
      let currentCount = article.translationCount;
      if (lastTranslation && (now.getTime() - lastTranslation.getTime()) > oneDayMs) {
        currentCount = 0;
      }

      // Enforce limit
      if (currentCount >= 10) {
        throw new Error("Translation rate limit exceeded: maximum 10 translations per day per article");
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

      // Increment translation count and update timestamp
      await prisma.article.update({
        where: { id: articleId },
        data: {
          translationCount: currentCount + 1,
          lastTranslationAt: now,
        },
      });

      return { locale: targetLocale, title: translated.title, content: translated.content };
    },
  );
}

/**
 * Drop all cached + persisted translations for an article. Called from
 * lib/articles.ts whenever the source article is edited so a stale revision is
 * never served.
 *
 * Also resets the translation rate limit counters (translationCount and
 * lastTranslationAt) since the article content has changed.
 *
 * Cache eviction is scoped to the article (prefix `cache:translation:${id}:`)
 * so other articles' translations are not collateral damage.
 */
export async function invalidateArticleTranslations(articleId: string): Promise<void> {
  try {
    await getPrisma().articleTranslation.deleteMany({ where: { articleId } });
  } catch (err) {
    log.warn("failed to delete translations for", articleId, err);
  }
  // Reset rate limit counters
  try {
    await getPrisma().article.update({
      where: { id: articleId },
      data: {
        translationCount: 0,
        lastTranslationAt: null,
      },
    });
  } catch (err) {
    log.warn("failed to reset translation rate limit for", articleId, err);
  }
  // Per-article cache eviction: keys are `cache:translation:${articleId}:${locale}`
  await invalidateByPrefix("translation", `${articleId}:`);
}

/**
 * Evict cached translations for an article whose DB rows have already been
 * cascade-deleted (i.e. the article itself was deleted). Only clears the
 * cache — no DB writes needed since the rows are gone and the article no
 * longer exists for rate-limit reset.
 */
export async function evictArticleTranslationCache(articleId: string): Promise<void> {
  await invalidateByPrefix("translation", `${articleId}:`);
}
