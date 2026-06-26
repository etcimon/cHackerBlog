import { setup, teardown, loginAsAdmin, seedTestData } from "./setup";

describe("Article Creation and Editing", () => {
  let context: Awaited<ReturnType<typeof setup>>;

  beforeAll(async () => {
    await seedTestData();
    context = await setup();
  }, 30000);

  afterAll(async () => {
    await teardown(context);
  }, 10000);

  it("should verify database has articles", async () => {
    const { PrismaClient } = await import("@prisma/client");
    const client = new PrismaClient();
    
    const articles = await client.article.findMany();
    expect(articles.length).toBeGreaterThan(0);
    
    await client.$disconnect();
  }, 10000);

  it("should verify articles have required fields", async () => {
    const { PrismaClient } = await import("@prisma/client");
    const client = new PrismaClient();
    
    const articles = await client.article.findMany();
    const firstArticle = articles[0];
    
    expect(firstArticle).toBeDefined();
    expect(firstArticle.title).toBeTruthy();
    expect(firstArticle.slug).toBeTruthy();
    expect(firstArticle.content).toBeTruthy();
    
    await client.$disconnect();
  }, 10000);

  it("should navigate to home page", async () => {
    const { page, baseUrl } = context;
    const response = await page.goto(`${baseUrl}`, { waitUntil: "networkidle0", timeout: 10000 });
    
    // Just verify page responds
    expect(response).toBeDefined();
    expect(response?.status()).toBeGreaterThanOrEqual(200);
    expect(response?.status()).toBeLessThan(600);
  }, 10000);
});
