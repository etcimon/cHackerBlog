# AGENTS.md

## Project Overview

cHackerBlog is a self-hosted, themable blogging platform built with Next.js 15, TypeScript, Bun, Prisma ORM, and Redis. It features infinite scroll, WYSIWYG editing, comment moderation, social auto-posting, internationalization (i18n) with 10 built-in locales, and on-demand article translation via Grok (x.ai).

## Architecture Layers

### Layer 1: Configuration & Infrastructure
- `src/lib/env.ts` - Zod-validated environment configuration (single source of truth)
- `src/lib/prisma.ts` - Prisma client singleton
- `src/lib/redis.ts` - Redis client singleton

### Layer 2: Cross-cutting Integrations
- `src/lib/cache.ts` - Multi-level caching (settings, article, feed, ipgeo)
- `src/lib/rate-limit.ts` - Cloudflare-aware rate limiting
- `src/lib/auth.ts` - Admin authentication with bcrypt and HMAC-signed cookies
- `src/lib/schemas.ts` - Shared Zod schemas for validation
- `src/lib/articles.ts` - Article CRUD, feed pagination, tag management
- `src/lib/settings.ts` - Site settings CRUD operations
- `src/lib/errors.ts` - Unified error envelope
- `src/lib/i18n.ts` - Internationalization utilities (locale resolution, path building, translation cache)
- `src/lib/grok.ts` - Grok (x.ai) API client for article translation

### Layer 3: Social Integrations
- `src/lib/social/index.ts` - Social auto-posting coordinator
- `src/lib/social/x.ts` - X (Twitter) OAuth1.0a integration
- `src/lib/social/linkedin.ts` - LinkedIn API integration

### Layer 4: API Routes
- `src/app/api/auth/` - Admin authentication
- `src/app/api/feed/` - Cursor-paginated feed with tag/locale filtering
- `src/app/api/articles/` - Article CRUD operations
- `src/app/api/articles/[id]/translate/` - Article translation via Grok
- `src/app/api/comments/` - Comment CRUD with moderation
- `src/app/api/settings/` - Site settings (GET public, PUT admin)
- `src/app/api/upload/` - Admin image upload
- `src/app/api/tags/` - Tag listing

### Layer 5: Client Components
- `src/components/providers.tsx` - Theme and context providers
- `src/components/feed.tsx` - Infinite scroll feed with prefetching
- `src/components/article-card.tsx` - Article display with in-place expansion and translation toggle
- `src/components/article-editor.tsx` - Article creation/editing form
- `src/components/wysiwyg.tsx` - WYSIWYG editor with markdown preview
- `src/components/admin-bar.tsx` - Floating admin controls with language settings
- `src/components/language-switcher.tsx` - Language dropdown for locale selection
- `src/components/api-client.ts` - API client with error handling
- `src/lib/use-i18n.ts` - Client i18n hook for locale resolution and translations
- `src/lib/use-site-config.ts` - Client config hook for site settings

### Layer 6: Pages
- `src/app/layout.tsx` - Root layout with theme injection
- `src/app/page.tsx` - Home feed with masthead
- `src/app/[lang]/page.tsx` - Localized home feed
- `src/app/[lang]/article/[slug]/page.tsx` - Localized article page
- `src/app/setup/page.tsx` - First-run setup screen

## Key Files

### Configuration
- `.env.example` - Environment variable template
- `prisma/schema.prisma` - Database schema definition
- `next.config.mjs` - Next.js configuration
- `tailwind.config.ts` - Tailwind CSS configuration

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
- **Styling:** Tailwind CSS 3.4
- **Testing:** Jest, Playwright

## Environment Variables

Required variables in `.env`:
- `DATABASE_URL` - Database connection string
- `REDIS_URL` - Redis connection string
- `SESSION_SECRET` - Session cookie signing secret
- `ADMIN_PASSWORD` - Admin password (or `ADMIN_PASSWORD_HASH`)

Optional variables include:
- `DISABLE_I18N` - Disable UI localization (force English-only)
- `GROK_API_KEY` - x.ai API key for article translation
- `GROK_BASE_URL` - x.ai API endpoint (default: `https://api.x.ai/v1`)
- `GROK_MODEL` - Model name (default: `grok-4.3`)
- `GROK_TEMPERATURE` - Sampling temperature (default: `0.2`)

See `.env.example` for full configuration options including theme, rate limiting, and social integrations.
