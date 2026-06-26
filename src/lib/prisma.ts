/**
 * Prisma client singleton. Next.js dev mode hot-reloads modules, which would
 * otherwise create a new client (and a new connection pool) on every reload.
 * Caching it on globalThis prevents connection exhaustion.
 */
import { PrismaClient } from "@prisma/client";
import { isProd } from "@/lib/env";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProd ? ["error"] : ["query", "warn", "error"],
  });

if (!isProd) globalForPrisma.prisma = prisma;
