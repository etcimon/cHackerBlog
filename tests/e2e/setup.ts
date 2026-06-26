import puppeteer, { Browser, Page } from "puppeteer";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export interface TestContext {
  browser: Browser;
  page: Page;
  baseUrl: string;
}

export async function setup(): Promise<TestContext> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3000";

  return { browser, page, baseUrl };
}

export async function teardown(context: TestContext): Promise<void> {
  await context.browser.close();
}

export async function loginAsAdmin(context: TestContext): Promise<void> {
  const { page, baseUrl } = context;
  await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle0", timeout: 10000 });
  
  // Wait for the login form to load - try multiple selectors
  try {
    await page.waitForSelector('input[type="password"], input[name="password"]', { timeout: 5000 });
    
    // Fill in admin credentials
    const passwordInput = await page.$('input[type="password"], input[name="password"]');
    if (passwordInput) {
      await passwordInput.type(process.env.TEST_ADMIN_PASSWORD || "admin123");
    }
    
    // Submit form
    const submitButton = await page.$('button[type="submit"]');
    if (submitButton) {
      await submitButton.click();
    }
    
    await page.waitForNavigation({ waitUntil: "networkidle0", timeout: 10000 });
  } catch (error) {
    // If login fails, might be because setup is not complete
    console.log("Login page not found or login failed, might need to complete setup first");
  }
}

export async function seedTestData(): Promise<void> {
  // Ensure setup is marked as complete
  await prisma.siteSettings.upsert({
    where: { id: 1 },
    update: { setupComplete: true },
    create: {
      id: 1,
      title: "Test Blog",
      description: "Test Description",
      authorName: "Test Author",
      setupComplete: true,
    },
  });

  // Create test articles if they don't exist
  const testArticles = [
    {
      slug: "test-article-1",
      title: "Test Article 1",
      preview: "Preview of test article 1",
      content: "<p>This is the first test article content.</p>",
      published: true,
    },
    {
      slug: "test-article-2",
      title: "Test Article 2",
      preview: "Preview of test article 2",
      content: "<p>This is the second test article content.</p>",
      published: true,
    },
    {
      slug: "test-article-3",
      title: "Test Article 3",
      preview: "Preview of test article 3",
      content: "<p>This is the third test article content.</p>",
      published: true,
    },
  ];

  for (const articleData of testArticles) {
    await prisma.article.upsert({
      where: { slug: articleData.slug },
      update: {},
      create: articleData,
    });
  }

  console.log("Test data seeded successfully");
}
