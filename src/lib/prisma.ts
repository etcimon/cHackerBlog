/**
 * Prisma client singleton. Next.js dev mode hot-reloads modules, which would
 * otherwise create a new client (and a new connection pool) on every reload.
 * Caching it on globalThis prevents connection exhaustion.
 *
 * For testing, use setTestPrisma() to inject a test client.
 */
import { PrismaClient } from "../generated/prisma/client/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { isProd, env } from "@/lib/env";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  testPrisma: PrismaClient | undefined;
};

let adapter: PrismaPg | PrismaLibSql;

if (env.DATABASE_PROVIDER === "postgresql") {
  adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
} else {
  adapter = new PrismaLibSql({ url: env.DATABASE_URL });
}

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    adapter,
    log: isProd ? ["error"] : ["query", "warn", "error"],
  });
}

export const prisma =
  globalForPrisma.prisma ??
  createPrismaClient();

if (!isProd) globalForPrisma.prisma = prisma;

/**
 * Set a test prisma client for testing purposes.
 * This overrides the default singleton for the duration of the test.
 */
export function setTestPrisma(client: PrismaClient): void {
  globalForPrisma.testPrisma = client;
}

/**
 * Get the current prisma client (test or production).
 */
export function getPrisma(): PrismaClient {
  return globalForPrisma.testPrisma ?? prisma;
}
