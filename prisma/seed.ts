/**
 * Seed script: ensures the SiteSettings singleton exists and inserts a few demo
 * articles/tags for local development. Idempotent — safe to run repeatedly.
 *
 * Run with: bun run db:seed
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const DATABASE_PROVIDER = process.env.DATABASE_PROVIDER || "sqlite";
const DATABASE_URL = process.env.DATABASE_URL || "file:./dev.db";

let adapter: PrismaPg | PrismaBetterSqlite3;

if (DATABASE_PROVIDER === "postgresql") {
  adapter = new PrismaPg({ connectionString: DATABASE_URL });
} else {
  adapter = new PrismaBetterSqlite3({ url: DATABASE_URL });
}

const prisma = new PrismaClient({ adapter });

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function main() {
  // Singleton settings row (not yet "complete" so /setup is reachable in dev).
  await prisma.siteSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      title: "cHackerBlog",
      description: "Cimon's Hacker Blog",
      authorName: "Cimon",
      setupComplete: false,
    },
  });

  const tagNames = ["security", "systems", "typescript", "meta"];
  const tags = await Promise.all(
    tagNames.map((name) =>
      prisma.tag.upsert({
        where: { slug: slugify(name) },
        update: {},
        create: { name, slug: slugify(name) },
      }),
    ),
  );

  const demo = [
    {
      title: "Bootstrapping cHackerBlog",
      content:
        "<p>This is the first article. It loads automatically and expanded by default.</p>",
      tagSlugs: ["meta", "typescript"],
    },
    {
      title: "Rate limiting at the edge with Redis",
      content: "<p>Full write-up about ioredis-backed rate limiting.</p>",
      tagSlugs: ["security", "systems"],
    },
    {
      title: "Theming with CSS variables",
      content: "<p>Green-on-black hacker terminal, switchable from .env. How runtime CSS variables drive the theme.</p>",
      tagSlugs: ["typescript"],
    },
  ];

  for (const [i, a] of demo.entries()) {
    const slug = slugify(a.title);
    await prisma.article.upsert({
      where: { slug },
      update: {},
      create: {
        slug,
        title: a.title,
        content: a.content,
        published: true,
        publishedAt: new Date(Date.now() - i * 86_400_000),
        tags: {
          connect: tags
            .filter((t) => a.tagSlugs.includes(t.slug))
            .map((t) => ({ id: t.id })),
        },
      },
    });
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
