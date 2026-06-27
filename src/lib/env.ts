/**
 * Centralized, zod-validated runtime configuration.
 *
 * Every other module imports `env` from here instead of touching process.env
 * directly. Validation runs once at import time and fails fast with a readable
 * error if configuration is invalid — this is the bottom of the dependency tree.
 */
import { z } from "zod";

/** Coerce common truthy strings to boolean. */
const boolish = z
  .union([z.string(), z.boolean()])
  .transform((v) => v === true || v === "true" || v === "1")
  .pipe(z.boolean());

/** Parse size strings like "200M", "1G", "500K" to bytes. */
const sizeBytes = z
  .string()
  .transform((val) => {
    const match = val.match(/^(\d+(?:\.\d+)?)([KMG])?$/i);
    if (!match) {
      throw new Error(`Invalid size format: ${val}. Use format like "200M", "1G", "500K"`);
    }
    const num = parseFloat(match[1]);
    const unit = (match[2] || "").toUpperCase();
    const multipliers: Record<string, number> = {
      "": 1,
      K: 1024,
      M: 1024 * 1024,
      G: 1024 * 1024 * 1024,
    };
    return Math.floor(num * (multipliers[unit] || 1));
  })
  .pipe(z.number().int().positive());

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),

  // Database
  DATABASE_PROVIDER: z.enum(["sqlite", "postgresql"]).default("sqlite"),
  DATABASE_URL: z.string().min(1),

  // Admin auth
  ADMIN_PASSWORD: z.string().optional(),
  ADMIN_PASSWORD_HASH: z.string().optional(),
  SESSION_SECRET: z.string().min(8).default("dev-insecure-secret-change-me"),

  // Logging
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "silent"])
    .default("info"),
  LOG_TO_FILE: boolish.default(true),
  LOG_TO_CONSOLE: boolish.default(true),
  LOG_DIR: z.string().default("./logs"),
  LOG_FILE: z.string().default("app.log"),

  // Redis / cache backend
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  REDIS_KEY_PREFIX: z.string().default("chb:"),
  // redis = always Redis; memory = always in-process; auto = Redis when ready,
  // else in-memory fallback (see lib/kv.ts).
  CACHE_DRIVER: z.enum(["redis", "memory", "auto"]).default("auto"),

  // Cache TTLs (seconds)
  CACHE_TTL_GLOBAL_SETTINGS: z.coerce.number().int().positive().default(300),
  CACHE_TTL_ARTICLE: z.coerce.number().int().positive().default(120),
  CACHE_TTL_FEED: z.coerce.number().int().positive().default(30),

  // Rate limiting
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(100),
  TRUST_CLOUDFLARE: boolish.default(true),

  // Feed / infinite scroll
  FEED_PAGE_SIZE: z.coerce.number().int().positive().max(50).default(5),
  FEED_PREFETCH_PAGES: z.coerce.number().int().nonnegative().max(5).default(1),
  // How many leading articles render fully expanded at the top of the feed.
  FEED_EXPANDED_COUNT: z.coerce.number().int().nonnegative().max(20).default(1),
  // Set to true to expand ALL articles in the feed (overrides FEED_EXPANDED_COUNT)
  FEED_EXPAND_ALL: boolish.default(false),
  // How many characters to show in feed preview (truncated from full content)
  FEED_PREVIEW_CHARS: z.coerce.number().int().positive().max(1000).default(200),
  // Feed expansion ratio (0-1): 1 = full screen like Medium, 0.5 = half screen
  FEED_EXPANSION_RATIO: z.coerce.number().min(0).max(1).default(0.5),

  // Theme: selects a compiled SCSS theme subset (see src/styles/themes/*).
  // Styling lives in SCSS, not in the database settings.
  THEME: z.enum(["hacker", "medium", "substack"]).default("hacker"),

  // Mailer
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default("cHackerBlog <noreply@example.com>"),

  // IP geolocation
  IPGEO_ENDPOINT: z.string().default("https://ipapi.co/{ip}/json/"),

  // Social auto-posting
  SOCIAL_AUTOPOST_ENABLED: boolish.default(false),
  X_API_KEY: z.string().optional(),
  X_API_SECRET: z.string().optional(),
  X_ACCESS_TOKEN: z.string().optional(),
  X_ACCESS_SECRET: z.string().optional(),
  LINKEDIN_ACCESS_TOKEN: z.string().optional(),
  LINKEDIN_AUTHOR_URN: z.string().optional(),

  // Uploads
  UPLOAD_DIR: z.string().default("./public/uploads"),
  UPLOAD_MAX_SIZE: sizeBytes.default("200M"),

  // Comments
  COMMENTS_ENABLED: boolish.default(true),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;
export type Env = typeof env;

export const isProd = env.NODE_ENV === "production";
export const isDev = env.NODE_ENV === "development";
