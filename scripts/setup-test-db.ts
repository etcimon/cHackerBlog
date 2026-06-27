import { PrismaClient } from "../src/generated/prisma/client/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { execSync } from "child_process";

async function setupTestDatabase() {
  console.log("Setting up test database...");

  // Set environment for test database
  process.env.DATABASE_URL = "file:./test.sqlite";

  // Generate Prisma client for test database
  console.log("Generating Prisma client...");
  execSync("bun run db:generate", { stdio: "inherit" });

  // Push schema to test database with environment variable
  console.log("Pushing schema to test database...");
  const env = { ...process.env, DATABASE_URL: "file:./test.sqlite" };
  execSync("bunx prisma db push --url=file:./test.sqlite", { stdio: "inherit", env });

  console.log("Test database setup complete!");
}

setupTestDatabase().catch((error) => {
  console.error("Error setting up test database:", error);
  process.exit(1);
});
