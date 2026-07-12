# cHackerBlog

**Cimon's Hacker Blog** — a self-hosted, themable, infinite-scroll blogging platform with a Medium-style reading experience and a green-on-black hacker terminal aesthetic.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/Bun-1.0+-black?style=flat&logo=bun)](https://bun.sh)
[![Next.js](https://img.shields.io/badge/Next.js-15-black?style=flat&logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue?style=flat&logo=typescript)](https://www.typescriptlang.org)
[![Prisma](https://img.shields.io/badge/Prisma-7-2D3748?style=flat&logo=prisma)](https://www.prisma.io)
[![Tests](https://github.com/etcimon/chackerblog/actions/workflows/test.yml/badge.svg)](https://github.com/etcimon/chackerblog/actions/workflows/test.yml)

![Logo](/logo.jpg)

**Repository:** <https://github.com/etcimon/chackerblog>

## Table of Contents

- [Features](#features)
- [SEO & Sharing](#seo--sharing)
- [Internationalization & Translation](#internationalization--translation)
- [Custom Embeds & Media](#custom-embeds--media)
- [Live Chat](#live-chat)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Development](#development)
- [Production Deployment](#production-deployment)
- [API Reference](#api-reference)
- [Contributing](#contributing)
- [License](#license)

## Features

- **Reading experience** — Medium-style infinite-scroll feed with prefetching, in-place article expansion, leading-article expansion, article pinning, and a themed hacker-style loading animation.
- **WYSIWYG editor** — rich text with live Markdown preview, image uploads, custom file/media embeds, and lossless round-tripping between rich-text and Markdown modes.
- **Theming** — three SCSS presets (`hacker`, `medium`, `substack`) emitted as `[data-theme]` CSS variables; selected via the `THEME` env var. Code highlighting is themeable via `CODE_THEME`.
- **Internationalization** — 10 built-in UI locales, `/[lang]/…` URL routing, per-visitor language negotiation, and optional on-demand article translation via Grok (x.ai).
- **SEO & sharing** — crawlable `/article/<slug>` routes with Open Graph / Twitter Card / canonical metadata, plus credential-free social share links.
- **Comments** — reader comments with moderation, spam detection, and age verification.
- **Social auto-posting** — optional auto-posting of new articles to X (Twitter) and LinkedIn.
- **Live chat** — a Telegram-relayed support widget with bidirectional attachments, real-time SSE delivery, and multi-group round-robin routing managed by in-chat commands.
- **Production-ready** — Redis-backed multi-level caching, Cloudflare-aware rate limiting, bcrypt admin auth with HMAC-signed cookies, and PM2 clustering. SQLite for dev, PostgreSQL for prod.

## SEO & Sharing

Every article is reachable at a canonical, crawlable slug path `/article/<slug>` (and `/[lang]/article/<slug>` per locale). The server route emits per-article Open Graph, Twitter Card, and canonical `<meta>` tags from auto-generated SEO fields (`seoKeywords`, `seoDescription`, `thumbnailUrl`), so JavaScript-less social crawlers get a correct title, description, and preview image with no API keys.

Instead of rendering each article in isolation, the slug route locates the target within a tag-scoped feed slice, then smooth-scrolls the reader to its `#<slug>-top` anchor once rendered. Sharing is entirely URL-based: the share modal builds credential-free intent links for X, Facebook, LinkedIn, Reddit, WhatsApp, Telegram, and Email — plus copy-link and the native device share sheet.

## Internationalization & Translation

**UI localization** covers English, Spanish, Chinese (Simplified), Hindi, Arabic, Portuguese, French, Russian, German, and Japanese.

- **Routing** — `/[lang]/` and `/[lang]/article/[slug]` select the UI language (e.g. `/fr`, `/ja/article/my-post`). The site default locale yields clean, unprefixed URLs.
- **Selector** — a footer/top-right language dropdown rewrites the current path to the chosen locale.
- **Policy** — admins set the default language and a translation mode (`default` or `user-specific`); in `user-specific` mode the UI follows the visitor's browser unless overridden by the URL prefix.
- **Kill-switch** — `DISABLE_I18N=true` forces English-only, hides the switcher, and 404s the `/[lang]/…` routes.

**On-demand article translation** (when `GROK_API_KEY` is set): article cards show a "show translation" toggle when the visitor's locale differs from the article's. Titles and bodies are translated via Grok as Markdown (preserving code blocks, embeds, and the `--END PREVIEW--` marker), cached in Redis, and persisted to the `ArticleTranslation` table.

- **Endpoint:** `POST /api/articles/[id]/translate` with `{ locale }` → `{ enabled, locale, title, content }`. Upstream Grok errors surface as HTTP 502.
- **Config:** `GROK_API_KEY`, `GROK_BASE_URL` (default `https://api.x.ai/v1`), `GROK_MODEL` (default `grok-4.3`; `grok-2-latest` is deprecated), `GROK_TEMPERATURE`, and the `GROK_TRANSLATION_PROMPT` / `GROK_TITLE_PROMPT` templates (placeholders: `{sourceLang} {targetLang} {sourceLocale} {targetLocale} {content}`).

## Custom Embeds & Media

Embed files, media, and external URLs with the `@[name](url)` grammar. Sizes round-trip losslessly between the rich-text and Markdown editor modes.

```markdown
@[document.pdf](https://example.com/doc.pdf)      # file card
@[video.mp4 640x360](https://example.com/v.mp4)   # pixels
@[audio.mp3 50%](https://example.com/a.mp3)       # percent width
@[clip.mp4 medium](https://example.com/c.mp4)     # preset: small|medium|large (320/640/960px)
@[v.mp4 width=640 height=360](https://ex.com/v)   # named params
```

**Size specs** apply to file embeds, URL embeds, and Markdown images. For images, append `{spec}` after the image: `![alt](url){medium}`, `{640x360}`, `{50%}`, or `{width=250 height=300}`.

**Supported file types:** video (mp4, webm, mov, avi, mkv, ogv, m4v), audio (mp3, wav, ogg, m4a, flac, aac, opus), documents (pdf, doc(x), odt, rtf, txt, md), spreadsheets (xls(x), csv, ods), slides (ppt(x), odp), archives (zip, rar, 7z, tar, gz).

**External URL embeds** — use `@[](url)` for a rich provider embed or generic link-preview card:

```markdown
@[](https://www.youtube.com/watch?v=Z_UOmAed5O8)  # rich provider embed
@[](https://example.com/some-post)                # generic link-preview card
@[urlOnly](https://example.com/some-post)          # plain link, no preview
@[640x360](https://youtu.be/abc)                   # size-controlled embed
```

Rich embeds are auto-rendered for YouTube / YouTube Music, Vimeo, Rumble, Twitch, X (Twitter), Facebook, Instagram, and SoundCloud. Unrecognized URLs render a link-preview card (Open Graph metadata, site name, "Visit site").

## Live Chat

An optional floating support widget relays visitor conversations to Telegram and streams agent replies back to the browser in real time over Server-Sent Events. Each conversation gets its own Telegram **forum topic**, and messages carry **bidirectional attachments** (images/video/audio/documents) — visitor uploads are stored on disk and relayed, agent media is downloaded and served through an authenticated per-conversation route. When Redis is unavailable the widget degrades gracefully to an in-memory bus plus DB polling (so replies still arrive across PM2 workers).

**Multi-group round-robin.** Support teams register groups from within Telegram, and new chats are distributed round-robin across the active groups:

- `/start` — register the group (and unpause it) to start receiving chats.
- `/pause` — stop routing *new* chats here; existing conversations continue.
- `/end` — close every open chat in the group and unregister it.
- `/close` — (in a conversation's topic) end that single conversation.

The single `TELEGRAM_SUPPORT_CHAT_ID` is only a fallback used until the first `/start`; once any group registers, an empty registry disables the widget. Requires Redis for the shared registry across workers.

**Setup:** set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_SUPPORT_CHAT_ID` (a supergroup with topics enabled), and — for real-time delivery in production — a public `TELEGRAM_WEBHOOK_URL` + `TELEGRAM_WEBHOOK_SECRET` (the webhook auto-registers on server startup). Hide the widget with `NEXT_PUBLIC_LIVE_CHAT_ENABLED=false`; disable uploads with `NEXT_PUBLIC_LIVE_CHAT_ATTACHMENTS_ENABLED=false` (re-checked server-side). All Telegram vars are optional — when unset the relay no-ops and messages persist with a delivery-error badge.

## Tech Stack

| Layer | Choice |
| --- | --- |
| Runtime | Bun 1.0+ |
| Framework | Next.js 15 (App Router), React 18 |
| Language | TypeScript 5.6 |
| Database | Prisma 7 — SQLite (dev), PostgreSQL (prod) |
| Caching | Redis via ioredis (in-memory fallback) |
| Validation | Zod 3.23, shared client/server |
| Forms | react-hook-form 7.52 + Zod resolvers |
| Styling | Tailwind CSS 3.4 + SCSS theme tokens |
| Markdown | marked (→HTML), turndown (→Markdown) |
| Highlighting | highlight.js |
| Email | nodemailer (SMTP) |
| Auth | bcryptjs |
| Testing | Bun test runner + Puppeteer |
| Process mgmt | PM2 (clustering) |

> Architecture and module layout are documented in [`AGENTS.md`](AGENTS.md).

## Quick Start

**Prerequisites:** [Bun 1.0+](https://bun.sh/docs/installation), [Redis](https://redis.io/docs/install/install-redis/), Node.js 20+ (for PM2 in prod), and PostgreSQL (prod only).

```bash
git clone https://github.com/etcimon/chackerblog.git
cd chackerblog
bun install

cp .env.example .env      # then edit; see Configuration
bun run db:migrate        # create the schema
bun run db:seed           # optional: demo content

bun run dev
```

Visit <http://localhost:3000>. On first boot you're redirected to `/setup` to configure the blog.

Prefer a guided setup? Run `setup-env.ps1` (Windows) or `setup-env.sh` (Linux/macOS) to check dependencies, generate a `SESSION_SECRET`, and create `.env`.

## Configuration

All configuration is via environment variables, validated at startup by Zod (`src/lib/env.ts`) — invalid config fails fast with a clear message. See [`.env.example`](.env.example) for the annotated, exhaustive list. Highlights:

| Variable | Purpose |
| --- | --- |
| `DATABASE_PROVIDER` / `DATABASE_URL` | `sqlite` (dev) or `postgresql` (prod) + connection string |
| `REDIS_URL` / `REDIS_KEY_PREFIX` / `CACHE_DRIVER` | Redis connection and cache backend (`redis`/`memory`/`auto`) |
| `ADMIN_PASSWORD` / `ADMIN_PASSWORD_HASH` | Admin login (prefer the bcrypt hash in prod) |
| `SESSION_SECRET` | Session cookie signing secret |
| `CACHE_TTL_*` | Cache durations for settings, article, feed, translation |
| `RATE_LIMIT_*` / `TRUST_CLOUDFLARE` | Rate-limit window/max and CF-Connecting-IP trust |
| `FEED_*` | Page size, prefetch, expansion, preview length |
| `THEME` / `CODE_THEME` | Theme preset and highlight.js stylesheet |
| `GROK_*` | Optional article translation via x.ai |
| `SOCIAL_AUTOPOST_ENABLED`, `X_*`, `LINKEDIN_*` | Optional social auto-posting |
| `TELEGRAM_*` / `CHAT_*` / `NEXT_PUBLIC_LIVE_CHAT_*` | Optional Telegram-relayed live chat (see [Live Chat](#live-chat)) |
| `SMTP_*` / `MAIL_FROM` | Optional email |
| `UPLOAD_DIR` / `UPLOAD_MAX_SIZE` | Uploads (size supports `K`/`M`/`G`) |
| `COMMENTS_ENABLED` / `DISABLE_I18N` | Feature toggles |

**Theming note:** theme colors and fonts live in SCSS (`src/styles/themes/*`), emitted as `[data-theme]` CSS variables — not in env. Only `THEME` (which preset) and `CODE_THEME` (code highlighting) affect styling from the environment. Presets: `hacker` (green-on-black terminal, default), `medium` (clean minimalist), `substack` (warm paper).

## Development

```bash
bun run dev           # start dev server
bun run build         # production build
bun run start         # start production server
bun run lint          # ESLint
bun run typecheck     # TypeScript check
bun run test          # all tests (bun test runner)
bun run test:unit     # unit tests only
bun run test:e2e      # e2e tests (Puppeteer)
bun run screenshots   # capture docs screenshots (dev server must be running)
```

**Database:**

```bash
bun run db:generate   # generate Prisma client
bun run db:migrate    # dev migrations
bun run db:deploy     # prod migrations
bun run db:seed       # seed demo content
bun run db:studio     # Prisma Studio
```

## Production Deployment

```bash
bun install
cp .env.example .env          # set NODE_ENV=production, PostgreSQL DATABASE_URL,
                              # REDIS_URL, SESSION_SECRET, ADMIN_PASSWORD_HASH
bun run db:generate
bun run db:deploy
bun run build
```

**PM2 (clustering):** a ready-made [`ecosystem.config.cjs`](ecosystem.config.cjs) ships in the repo (cluster mode, all cores, auto-restart, memory cap, log rotation-friendly).

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs   # start clustered
pm2 logs chackerblog             # tail logs
pm2 restart chackerblog          # restart
pm2 save && pm2 startup          # persist across reboots
```

**Docker:** a [`Dockerfile`](Dockerfile) is included.

```bash
docker build -t chackerblog .
docker run -p 3000:3000 --env-file .env chackerblog
```

**PostgreSQL backup:** `pg_dump -U user -d chackerblog > backup.sql` / `psql -U user -d chackerblog < backup.sql`.

## API Reference

Responses use a unified envelope: `{ ok: true, data }` on success, or an error object otherwise. Admin-only endpoints require a valid session cookie (obtained by `POST /api/auth` with the admin password).

| Method & Path | Description | Auth |
| --- | --- | --- |
| `POST /api/auth` | Admin login | — |
| `GET /api/feed` | Paginated feed (`cursor`, `tag`, `locale`, `take`) | — |
| `GET /api/tags` | List tags | — |
| `POST /api/articles` | Create article | admin |
| `GET /api/articles/[id]` | Get article body | — |
| `PUT /api/articles/[id]` | Update article | admin |
| `DELETE /api/articles/[id]` | Delete article | admin |
| `POST` / `DELETE /api/articles/[id]/pin` | Pin / unpin | admin |
| `POST /api/articles/[id]/translate` | Translate (`{ locale }`) | admin |
| `GET /api/comments?articleId=…` | Approved comments | — |
| `POST /api/comments` | Submit comment | — |
| `GET /api/comments/admin` | Pending comments | admin |
| `PATCH /api/comments/admin` | Moderate a comment | admin |
| `GET /api/settings` | Public site settings | — |
| `PUT /api/settings` | Update settings | admin |
| `GET` / `PUT /api/legal/[slug]` | Legal page (privacy, terms) | PUT: admin |
| `POST /api/upload` | Image upload | admin |
| `GET /api/link-preview` | Fetch link metadata for embeds | — |
| `GET /api/chat/config` | Live-chat availability (`{ enabled }`) | — |
| `POST /api/chat/send` | Send a chat message (JSON) or attachment (multipart) | — |
| `GET /api/chat/stream?visitorId=…` | SSE history + live message/status events | — |
| `POST /api/chat/close` | Close the visitor's chat session | — |
| `GET /api/chat/attachments/[id]?visitorId=…` | Authenticated attachment bytes | — |
| `POST /api/chat/telegram` | Telegram webhook (agent replies / commands) | secret |

Example feed item shape:

```json
{
  "id": "…", "slug": "…", "title": "…", "preview": "…",
  "coverUrl": "… | null", "locale": "en", "publishedAt": "ISO8601",
  "tags": ["…"], "pinned": false, "pinnedAt": "ISO8601 | null"
}
```

## Contributing

1. Fork and create a feature branch (`git checkout -b feature/xyz`).
2. Make changes with tests, then verify: `bun run typecheck && bun run lint && bun run test`.
3. Commit with a clear message and open a Pull Request.

Use TypeScript for all new code and follow the existing ESLint config. See [`AGENTS.md`](AGENTS.md) for architecture and where new code belongs.

## License

MIT — see [LICENSE](LICENSE).

---

**Repository:** <https://github.com/etcimon/chackerblog> · **Issues:** <https://github.com/etcimon/chackerblog/issues>
