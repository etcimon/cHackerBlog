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

/**
 * A string schema whose default also applies when the env var is present but
 * blank (e.g. `FOO=` in .env). Plain `.default()` only fires on `undefined`, so
 * we normalize empty/whitespace-only values to `undefined` first. This lets
 * `.env.example` ship blank tunables that fall back to code-defined defaults.
 */
const stringWithDefault = (def: string, refine?: (s: z.ZodString) => z.ZodTypeAny) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    (refine ? refine(z.string()) : z.string()).default(def) as z.ZodTypeAny,
  );

/**
 * Default Grok translation prompt for article bodies. Operates on Markdown so
 * structural elements survive intact. Placeholders substituted at call time:
 *   {sourceLang} {targetLang} {sourceLocale} {targetLocale} {content}
 * Tune this in the environment (GROK_TRANSLATION_PROMPT) to adjust tone,
 * formality, or glossary handling without touching code.
 */
export const DEFAULT_GROK_TRANSLATION_PROMPT = `You are a professional translator. Translate the following Markdown document from {sourceLang} to {targetLang}.
Rules:
- Preserve ALL Markdown structure exactly: headings, lists, tables, blockquotes, and emphasis.
- Do NOT translate or alter fenced code blocks, inline code, URLs, HTML tags, or image/link targets.
- Preserve embed tags of the form @[label](url) exactly; you may translate the visible label text only.
- Keep the literal marker --END PREVIEW-- unchanged and in its original position.
- Return ONLY the translated Markdown, with no commentary and no surrounding code fences.

{content}`;

/**
 * Default Grok prompt for translating a short article title. Placeholders:
 *   {sourceLang} {targetLang} {sourceLocale} {targetLocale} {content}
 */
export const DEFAULT_GROK_TITLE_PROMPT = `Translate the following blog article title from {sourceLang} to {targetLang}. Return only the translated title text, with no quotes, labels, or extra words.

{content}`;

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
  // Translations are a pure function of an article revision, so they can live
  // much longer (invalidated explicitly on article edit/delete).
  CACHE_TTL_TRANSLATION: z.coerce.number().int().positive().default(86_400),

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

  // Code syntax-highlighting theme (any highlight.js stylesheet name, e.g.
  // "github", "monokai", "nord", "atom-one-dark"). The special default
  // "github" auto-resolves to "github-dark" on dark site themes (hacker).
  CODE_THEME: z.string().default("github"),

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

  // Grok (x.ai) translation (optional; feature enabled only if GROK_API_KEY set).
  GROK_API_KEY: z.string().optional(),
  GROK_BASE_URL: stringWithDefault("https://api.x.ai/v1", (s) => s.url()),
  // Must be a model your API key can access. `grok-2-latest` is deprecated and
  // returns HTTP 400 ("model does not exist"); `grok-4.3` (alias grok-latest)
  // is the current recommended chat model. See https://docs.x.ai/developers/models
  GROK_MODEL: stringWithDefault("grok-4.3"),
  GROK_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
  // Max characters per chunk when splitting article markdown for translation.
  // Chunks are split on line boundaries and never through code blocks/embeds.
  GROK_CHUNK_SIZE: z.coerce.number().int().positive().default(1000),
  // Global rate limit for Grok API calls (per day). Resets at midnight UTC.
  GROK_RATE_LIMIT_DAY: z.coerce.number().int().positive().default(100),
  // Tunable prompt templates (placeholders documented above the defaults).
  GROK_TRANSLATION_PROMPT: stringWithDefault(DEFAULT_GROK_TRANSLATION_PROMPT),
  GROK_TITLE_PROMPT: stringWithDefault(DEFAULT_GROK_TITLE_PROMPT),

  // Uploads
  UPLOAD_DIR: z.string().default("./public/uploads"),
  UPLOAD_MAX_SIZE: sizeBytes.default("200M"),

  // Comments
  COMMENTS_ENABLED: boolish.default(true),

  // Internationalization kill-switch. When true, the site is forced to English,
  // the /[lang]/... URL scheme is disabled (404), and the footer language
  // switcher is hidden. Article-level Grok translation is unaffected.
  DISABLE_I18N: boolish.default(false),

  // Live chat (Telegram-relayed). The widget is hidden client-side when
  // NEXT_PUBLIC_LIVE_CHAT_ENABLED="false". Telegram creds are optional: when any
  // is missing the relay simply no-ops (messages persist with a delivery-error
  // badge) and the startup webhook registration is skipped. Note: storage/flag
  // helpers in lib/chat/storage.ts read process.env directly (at call time) so
  // they can be mutated per-request/test; these entries are for validation/docs.
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_SUPPORT_CHAT_ID: z.string().optional(),
  TELEGRAM_WEBHOOK_URL: z.string().url().optional().or(z.literal("")),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  // Attachment store: directory (relative to cwd) + max single-upload size (MB).
  CHAT_UPLOAD_DIR: z.string().default("chat-uploads"),
  CHAT_MAX_UPLOAD_MB: z.coerce.number().int().positive().default(20),
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

/**
 * Whether the Grok translation integration is usable. Mirrors the optional-
 * integration pattern of social auto-posting: absent credentials disable the
 * feature entirely (no "show translation" affordance is rendered).
 */
export function grokConfigured(): boolean {
  return typeof env.GROK_API_KEY === "string" && env.GROK_API_KEY.length > 0;
}
