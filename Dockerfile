# Multi-stage Dockerfile for cHackerBlog with Bun and Next.js
# Optimized for Coolify deployment

FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production=false

# Build the application
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client
RUN bun run db:generate

# Build Next.js app
RUN bun run build

# Production runtime (minimal image)
FROM oven/bun:1-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Install production dependencies only
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production

# Copy built application
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Copy Prisma schema and migrations for runtime migrations
COPY --from=builder /app/prisma ./prisma

# Create uploads directory for file uploads
RUN mkdir -p /app/public/uploads

# Expose the port
EXPOSE 3000

# Run the application
CMD ["bun", "run", "server.js"]
