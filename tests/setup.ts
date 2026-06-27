// Global test setup
import { PrismaClient } from "../src/generated/prisma/client/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

const adapter = new PrismaLibSql({ url: "file:./test.sqlite" });
(globalThis as any).prisma = new PrismaClient({ adapter });
