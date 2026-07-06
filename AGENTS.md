# AGENTS.md

## Project Overview

cHackerBlog is a self-hosted, themable blogging platform built with Next.js 15, TypeScript, Bun, Prisma ORM, and Redis. It features infinite scroll, a WYSIWYG editor with rich file/URL embeds, comment moderation, social auto-posting, SEO/Open Graph slug routes, internationalization (i18n) with 10 built-in locales, and on-demand article translation via Grok (x.ai).

## Architecture Layers

Bottom-up layering: each layer depends only on those below it.

### Layer 1: Configuration & Infrastructure
- `src/lib/env.ts` - Zod-validated environment configuration (single source of truth)
- `src/lib/prisma.ts` - Prisma client singleton
- `src/lib/redis.ts` - Redis client singleton
- `src/lib/kv.ts` - KV abstraction (Redis or in-memory fallback, per `CACHE_DRIVER`)
- `src/lib/local-cache.ts` - In-process cache fallback
- `src/lib/logger.ts` - Structured logger (console + file sinks)

### Layer 2: Cross-cutting Integrations
- `src/lib/cache.ts` - Multi-level caching (settings, article, feed, ipgeo, translation)
- `src/lib/rate-limit.ts` - Cloudflare-aware rate limiting
- `src/lib/ip-geo.ts` - IP geolocation lookup
- `src/lib/mailer.ts` - Nodemailer SMTP wrapper
- `src/lib/auth.ts` - Admin authentication with bcrypt and HMAC-signed cookies
- `src/lib/schemas.ts` - Shared Zod schemas for validation
- `src/lib/errors.ts` - Unified error envelope
- `src/lib/types.ts` - Shared TypeScript types (FeedItem, TagItem, etc.)
- `src/lib/theme.ts` - Theme + code-highlight theme resolution (reads `THEME`/`CODE_THEME`)
- `src/lib/articles.ts` - Article CRUD, feed pagination, tag management
- `src/lib/settings.ts` - Site settings CRUD operations
- `src/lib/feed-locator.ts` - Locates an article within a tag-scoped feed slice (for slug routes)
- `src/lib/seo.ts` - Open Graph / Twitter Card / canonical metadata generation
- `src/lib/comment-validation.ts` - Comment spam detection and validation
- `src/lib/i18n.ts` - Internationalization utilities (locale resolution, path building, translation cache)
- `src/lib/grok.ts` - Grok (x.ai) API client for article translation
- `src/lib/highlight.ts` - Server-side syntax highlighting (highlight.js)
- `src/lib/embeds.ts` - Custom `@[...]( ...)` embed grammar; markdown<->HTML round-trip
- `src/lib/ext-embeds.ts` - Provider embeds (YouTube, Vimeo, X, etc.)
- `src/lib/link-embeds.ts` / `src/lib/link-preview.ts` - Generic link-preview cards

### Layer 3: Social Integrations
- `src/lib/social/index.ts` - Social auto-posting coordinator
- `src/lib/social/x.ts` - X (Twitter) OAuth1.0a integration
- `src/lib/social/linkedin.ts` - LinkedIn API integration
- `src/lib/sharing/` - Share intent-link builders (URL-based, credential-free)

### Layer 4: API Routes
- `src/app/api/auth/` - Admin authentication
- `src/app/api/feed/` - Cursor-paginated feed with tag/locale filtering
- `src/app/api/articles/` - Article CRUD operations
- `src/app/api/articles/[id]/pin/` - Pin/unpin an article
- `src/app/api/articles/[id]/translate/` - Article translation via Grok
- `src/app/api/comments/` - Comment CRUD with moderation (`/admin` for moderation)
- `src/app/api/settings/` - Site settings (GET public, PUT admin)
- `src/app/api/legal/[slug]/` - Legal pages (privacy, terms) read/edit
- `src/app/api/upload/` + `src/app/api/uploads/` - Admin image upload and serving
- `src/app/api/tags/` - Tag listing
- `src/app/api/link-preview/` - Server-side link metadata fetch for embeds
- `src/app/api/highlightjs/` - Serves the resolved highlight.js stylesheet

### Layer 5: Client Components
- `src/components/providers.tsx` - Theme and context providers
- `src/components/admin-context.tsx` - Admin auth context
- `src/components/toast.tsx` - Toast notification system
- `src/components/feed.tsx` - Infinite scroll feed with prefetching
- `src/components/feed-loader.tsx` - Themed "hack-ish" animated loading indicator
- `src/components/article-card.tsx` - Article display with in-place expansion and translation toggle
- `src/components/article-editor.tsx` - Article creation/editing form
- `src/components/wysiwyg.tsx` - WYSIWYG editor with markdown preview and embeds
- `src/components/code-block.tsx` - Collapsible highlighted code block
- `src/components/comment-bar.tsx` - Comment/share/reference controls and form
- `src/components/share-modal.tsx` - Social share overlay (intent links + native share)
- `src/components/tag-bar.tsx` - Tag filter bar
- `src/components/admin-bar.tsx` - Floating admin controls with site settings modal
- `src/components/footer.tsx` - Footer + top-right controls, legal link modals
- `src/components/language-switcher.tsx` - Language dropdown for locale selection
- `src/components/terminal-caret.tsx` - Animated terminal caret masthead effect
- `src/lib/api-client.ts` - API client with error handling (`ApiClientError`)
- `src/lib/use-i18n.ts` - Client i18n hook for locale resolution and translations
- `src/lib/use-site-config.ts` - Client config hook for site settings
- `src/lib/use-comments-enabled.ts` - Client hook for the comments toggle

### Layer 6: Pages & Styling
- `src/app/layout.tsx` - Root layout with theme injection (`<html data-theme>`)
- `src/app/page.tsx` - Home feed with masthead
- `src/app/[lang]/page.tsx` - Localized home feed
- `src/app/[lang]/article/[slug]/page.tsx` - Localized article slug route (SEO metadata)
- `src/app/article/[slug]/page.tsx` - Default-locale article slug route
- `src/app/setup/page.tsx` - First-run setup screen
- `src/styles/themes/*` - SCSS theme palettes/tokens emitted as `[data-theme]` CSS vars
- `src/locales/*.json` - UI translation strings (10 locales)

## Key Files

### Configuration
- `.env.example` - Environment variable template
- `prisma/schema.prisma` - Database schema definition
- `next.config.mjs` - Next.js configuration
- `tailwind.config.ts` - Tailwind CSS configuration (consumes `--cb-*` theme vars)
- `jest.config.cjs` - Jest config (tests run via the Bun test runner)
- `ecosystem.config.cjs` - PM2 clustering config for production

### Entry Points
- `src/app/layout.tsx` - Root layout entry
- `src/app/page.tsx` - Home page entry
- `package.json` - Dependencies and scripts

## Common Tasks

### Database Operations
```bash
bun run db:generate   # Generate Prisma client
bun run db:migrate    # Run development migrations
bun run db:deploy     # Run production migrations
bun run db:seed       # Seed with demo content
bun run db:studio     # Open Prisma Studio
```

### Development
```bash
bun run dev           # Start development server
bun run build         # Build for production
bun run typecheck     # TypeScript type checking
bun run lint          # ESLint
bun run test          # Run tests
```

### Adding New Features
1. Add Zod schema to `src/lib/schemas.ts` if needed
2. Implement business logic in appropriate `src/lib/` module
3. Create API route in `src/app/api/` if server endpoint needed
4. Create client component in `src/components/` if UI needed
5. Add page in `src/app/` if new route needed

## Tech Stack

- **Runtime:** Bun 1.0+
- **Framework:** Next.js 15 (App Router)
- **Language:** TypeScript 5.6
- **Database:** Prisma 7 (SQLite dev, PostgreSQL prod)
- **Caching:** Redis (ioredis)
- **Validation:** Zod 3.23
- **Styling:** Tailwind CSS 3.4 + SCSS theme tokens (`src/styles/themes/*`)
- **Testing:** Bun test runner (unit + e2e); Puppeteer for e2e and screenshots

## Environment Variables

Required variables in `.env`:
- `DATABASE_URL` - Database connection string
- `REDIS_URL` - Redis connection string
- `SESSION_SECRET` - Session cookie signing secret
- `ADMIN_PASSWORD` - Admin password (or `ADMIN_PASSWORD_HASH`)

Optional variables include:
- `THEME` - Theme preset: `hacker`, `medium`, or `substack` (colors/fonts live in SCSS, not env)
- `CODE_THEME` - highlight.js stylesheet name (default: `github`, auto dark on dark themes)
- `DISABLE_I18N` - Disable UI localization (force English-only)
- `GROK_API_KEY` - x.ai API key for article translation
- `GROK_BASE_URL` - x.ai API endpoint (default: `https://api.x.ai/v1`)
- `GROK_MODEL` - Model name (default: `grok-4.3`)
- `GROK_TEMPERATURE` - Sampling temperature (default: `0.2`)

Note: theme colors and fonts are defined in `src/styles/themes/*` (SCSS), not via
env vars. Only `THEME` (preset selection) and `CODE_THEME` affect styling from env.

See `.env.example` for full configuration options including feed tuning, rate
limiting, uploads, mailer, and social integrations.
