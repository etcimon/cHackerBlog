# AGENTS.md

## Project Overview

cHackerBlog is a self-hosted, themable blogging platform built with Next.js 15, TypeScript, Bun, Prisma ORM, and Redis. It features infinite scroll, WYSIWYG editing, comment moderation, and social auto-posting.

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

### Layer 3: Social Integrations
- `src/lib/social/index.ts` - Social auto-posting coordinator
- `src/lib/social/x.ts` - X (Twitter) OAuth1.0a integration
- `src/lib/social/linkedin.ts` - LinkedIn API integration

### Layer 4: API Routes
- `src/app/api/auth/` - Admin authentication
- `src/app/api/feed/` - Cursor-paginated feed with tag/locale filtering
- `src/app/api/articles/` - Article CRUD operations
- `src/app/api/comments/` - Comment CRUD with moderation
- `src/app/api/settings/` - Site settings (GET public, PUT admin)
- `src/app/api/upload/` - Admin image upload
- `src/app/api/tags/` - Tag listing

### Layer 5: Client Components
- `src/components/providers.tsx` - Theme and context providers
- `src/components/feed.tsx` - Infinite scroll feed with prefetching
- `src/components/article-card.tsx` - Article display with in-place expansion
- `src/components/article-editor.tsx` - Article creation/editing form
- `src/components/wysiwyg.tsx` - WYSIWYG editor with markdown preview
- `src/components/admin-bar.tsx` - Floating admin controls
- `src/components/api-client.ts` - API client with error handling

### Layer 6: Pages
- `src/app/layout.tsx` - Root layout with theme injection
- `src/app/page.tsx` - Home feed with masthead
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

See `.env.example` for full configuration options including theme, rate limiting, and social integrations.
