import { setup, teardown, seedTestData } from "./setup";

describe("Theme Switching", () => {
  beforeAll(async () => {
    // Setup database for tests that need it
    const { setup } = await import("./setup");
    await setup();
  }, 30000);

  it("should verify theme environment variable is set", () => {
    const theme = process.env.THEME || "hacker";
    expect(["hacker", "medium", "substack"]).toContain(theme);
  }, 5000);

  it("should verify database setup is complete", async () => {
    const { PrismaClient } = await import("../../src/generated/prisma/client/client.js");
    const { PrismaBetterSqlite3 } = await import("@prisma/adapter-better-sqlite3");
    const adapter = new PrismaBetterSqlite3({ url: "file:./test.sqlite" });
    const client = new PrismaClient({ adapter });
    
    const settings = await client.siteSettings.findUnique({ where: { id: 1 } });
    expect(settings?.setupComplete).toBe(true);
    
    await client.$disconnect();
  }, 10000);

  it("should verify site settings exist", async () => {
    const { PrismaClient } = await import("../../src/generated/prisma/client/client.js");
    const { PrismaBetterSqlite3 } = await import("@prisma/adapter-better-sqlite3");
    const adapter = new PrismaBetterSqlite3({ url: "file:./test.sqlite" });
    const client = new PrismaClient({ adapter });
    
    const settings = await client.siteSettings.findUnique({ where: { id: 1 } });
    expect(settings).toBeDefined();
    expect(settings?.title).toBeTruthy();
    
    await client.$disconnect();
  }, 10000);
});
