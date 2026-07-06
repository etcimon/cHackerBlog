/**
 * Interactive CLI for testing the Grok article translation pipeline.
 *
 * Polls the database for article slugs, lets you pick one by number or enter
 * a slug manually, choose a target locale, and then runs the full chunked
 * translation pipeline — printing each chunk's progress and the final
 * reassembled HTML result.
 *
 * Usage:
 *   bun run scripts/test-grok-translation.ts
 *
 * Environment:
 *   Reads .env (or .env.test) for DATABASE_URL, GROK_API_KEY, etc.
 *   Use GROK_CHUNK_SIZE to control the max characters per chunk (default 4000).
 */
import { config } from "dotenv";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { PrismaClient } from "../src/generated/prisma/client/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import {
  translateArticleBody,
  htmlToTranslatableMarkdown,
  chunkMarkdown,
  markdownToHtml,
} from "../src/lib/grok";
import { SUPPORTED_LOCALES, SUPPORTED_LOCALE_CODES, localeLabel, type Locale } from "../src/lib/i18n";

config();

const rl = readline.createInterface({ input, output });

function close() {
  rl.close();
}

async function ask(question: string): Promise<string> {
  const answer = await rl.question(question);
  return answer.trim();
}

async function askNumber(question: string, min: number, max: number): Promise<number | null> {
  const answer = await ask(question);
  if (answer === "") return null;
  const num = parseInt(answer, 10);
  if (isNaN(num) || num < min || num > max) {
    console.log(`  Invalid selection. Enter a number between ${min} and ${max}.`);
    return null;
  }
  return num;
}

function separator(char = "=", length = 70) {
  console.log(char.repeat(length));
}

async function main() {
  separator();
  console.log("  Grok Translation Test CLI");
  console.log("  Tests the chunked translation pipeline against real articles");
  separator();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("ERROR: DATABASE_URL is not set. Check your .env file.");
    close();
    process.exit(1);
  }

  const grokKey = process.env.GROK_API_KEY;
  if (!grokKey) {
    console.error("ERROR: GROK_API_KEY is not set. Translation will fail.");
    console.error("Set it in your .env file to test live Grok translations.");
    close();
    process.exit(1);
  }

  const chunkSize = parseInt(process.env.GROK_CHUNK_SIZE ?? "4000", 10);
  console.log(`\n  Configuration:`);
  console.log(`    Database: ${databaseUrl}`);
  console.log(`    Grok model: ${process.env.GROK_MODEL ?? "grok-4.3"}`);
  console.log(`    Chunk size: ${chunkSize} chars`);
  console.log();

  // Set up Prisma client
  const adapter = new PrismaLibSql({ url: databaseUrl });
  const prisma = new PrismaClient({ adapter });

  // Fetch articles
  const articles = await prisma.article.findMany({
    select: {
      id: true,
      slug: true,
      title: true,
      locale: true,
      published: true,
      content: true,
    },
    orderBy: { publishedAt: "desc" },
  });

  if (articles.length === 0) {
    console.log("No articles found in the database.");
    close();
    await prisma.$disconnect();
    return;
  }

  // Separate published and unpublished
  const published = articles.filter((a) => a.published);
  const unpublished = articles.filter((a) => !a.published);

  // Step 1: Choose environment
  separator("-");
  console.log("  Select article source:");
  console.log(`  [1] Published articles (${published.length})`);
  console.log(`  [2] Unpublished / draft articles (${unpublished.length})`);
  console.log(`  [3] All articles (${articles.length})`);
  console.log(`  [4] Enter slug manually`);
  separator("-");

  const envChoice = await askNumber("  Selection (1-4): ", 1, 4);
  if (envChoice === null) {
    console.log("Cancelled.");
    close();
    await prisma.$disconnect();
    return;
  }

  let selectedArticle: (typeof articles)[0] | null = null;

  if (envChoice === 4) {
    // Manual slug entry
    const slug = await ask("  Enter article slug: ");
    if (!slug) {
      console.log("No slug entered. Exiting.");
      close();
      await prisma.$disconnect();
      return;
    }
    selectedArticle = articles.find((a) => a.slug === slug) ?? null;
    if (!selectedArticle) {
      // Try database lookup in case it's not in the initial fetch
      selectedArticle = await prisma.article.findUnique({
        where: { slug },
        select: { id: true, slug: true, title: true, locale: true, published: true, content: true },
      });
    }
    if (!selectedArticle) {
      console.log(`Article with slug "${slug}" not found.`);
      close();
      await prisma.$disconnect();
      return;
    }
  } else {
    const pool = envChoice === 1 ? published : envChoice === 2 ? unpublished : articles;
    if (pool.length === 0) {
      console.log("No articles in this category.");
      close();
      await prisma.$disconnect();
      return;
    }

    // Step 2: List articles for selection
    separator("-");
    console.log("  Available articles:");
    pool.forEach((a, i) => {
      const status = a.published ? "pub" : "draft";
      const titlePreview = a.title.length > 50 ? a.title.slice(0, 50) + "..." : a.title;
      console.log(`  [${i + 1}] (${status}) ${a.slug} — "${titlePreview}" [${a.locale}]`);
    });
    separator("-");

    const articleChoice = await askNumber(`  Select article (1-${pool.length}): `, 1, pool.length);
    if (articleChoice === null) {
      console.log("Cancelled.");
      close();
      await prisma.$disconnect();
      return;
    }
    selectedArticle = pool[articleChoice - 1]!;
  }

  if (!selectedArticle) {
    console.log("No article selected. Exiting.");
    close();
    await prisma.$disconnect();
    return;
  }

  console.log(`\n  Selected: "${selectedArticle.title}" (${selectedArticle.slug})`);
  console.log(`  Source locale: ${selectedArticle.locale} (${localeLabel(selectedArticle.locale)})`);

  // Step 3: Choose target locale
  separator("-");
  console.log("  Select target locale:");
  SUPPORTED_LOCALES.forEach((l, i) => {
    const marker = l.code === selectedArticle!.locale ? " (source)" : "";
    console.log(`  [${i + 1}] ${l.label} (${l.nativeName})${marker}`);
  });
  separator("-");

  const localeChoice = await askNumber(`  Selection (1-${SUPPORTED_LOCALES.length}): `, 1, SUPPORTED_LOCALES.length);
  if (localeChoice === null) {
    console.log("Cancelled.");
    close();
    await prisma.$disconnect();
    return;
  }

  const targetLocale = SUPPORTED_LOCALES[localeChoice - 1]!.code as Locale;

  if (targetLocale === selectedArticle.locale) {
    console.log("\n  Target locale is the same as source. Nothing to translate.");
    close();
    await prisma.$disconnect();
    return;
  }

  console.log(`\n  Target locale: ${targetLocale} (${localeLabel(targetLocale)})`);

  // Step 4: Preview the chunking
  separator();
  console.log("  Step 1: Converting HTML to Markdown...");
  const markdown = htmlToTranslatableMarkdown(selectedArticle.content);
  console.log(`  Markdown length: ${markdown.length} chars`);

  console.log("\n  Step 2: Chunking markdown...");
  const chunks = chunkMarkdown(markdown, chunkSize);
  console.log(`  Created ${chunks.length} chunk(s):`);
  chunks.forEach((c, i) => {
    const preview = c.slice(0, 80).replace(/\n/g, "\\n");
    console.log(`    Chunk ${i + 1}/${chunks.length}: ${c.length} chars — "${preview}..."`);
  });

  // Step 5: Confirm and run translation
  separator();
  console.log("  Ready to translate. This will call the Grok API for each chunk.");
  const confirm = await ask("  Proceed? (y/N): ");
  if (confirm.toLowerCase() !== "y" && confirm.toLowerCase() !== "yes") {
    console.log("Aborted.");
    close();
    await prisma.$disconnect();
    return;
  }

  separator();
  console.log("  Step 3: Translating via Grok...\n");

  const startTime = Date.now();

  try {
    const result = await translateArticleBody({
      title: selectedArticle.title,
      contentHtml: selectedArticle.content,
      sourceLocale: selectedArticle.locale,
      targetLocale,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    separator();
    console.log(`\n  Translation complete in ${elapsed}s`);
    separator();

    console.log("\n  Translated title:");
    console.log(`    "${result.title}"`);

    console.log("\n  Translated content (HTML):");
    console.log(`    Length: ${result.content.length} chars`);
    console.log(`    Preview (first 500 chars):`);
    console.log(`    ${result.content.slice(0, 500).replace(/\n/g, "\n    ")}`);

    if (result.content.length > 500) {
      console.log(`    ... (${result.content.length - 500} more chars)`);
    }

    // Show the markdown round-trip for verification
    console.log("\n  Round-trip verification (translated HTML -> Markdown):");
    const backToMd = htmlToTranslatableMarkdown(result.content);
    console.log(`    Markdown length: ${backToMd.length} chars`);
    console.log(`    Preview (first 300 chars):`);
    console.log(`    ${backToMd.slice(0, 300).replace(/\n/g, "\n    ")}`);

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n  Translation failed: ${message}`);
  }

  separator();
  console.log("  Done.");
  close();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  close();
  process.exit(1);
});
