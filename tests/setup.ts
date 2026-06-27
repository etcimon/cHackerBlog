// Global test setup
import { PrismaClient } from "../src/generated/prisma/client/client.js";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const adapter = new PrismaBetterSqlite3({ url: "file:./test.sqlite" });
(globalThis as any).prisma = new PrismaClient({ adapter });
