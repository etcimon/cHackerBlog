import puppeteer, { Browser, Page } from "puppeteer";
import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";

// Load test environment variables
config({ path: ".env.test" });

const prisma = new PrismaClient();

export interface TestContext {
  browser: Browser;
  page: Page;
  baseUrl: string;
}

async function truncateDatabase(): Promise<void> {
  console.log("Truncating test database...");

  // Delete all data from all tables in the correct order (respecting foreign keys)
  await prisma.comment.deleteMany();
  await prisma.article.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.siteSettings.deleteMany();

  console.log("Test database truncated");
}

export async function setup(): Promise<TestContext> {
  console.log("Setting up e2e test environment...");

  // Truncate database before tests
  await truncateDatabase();

  // Seed test data after truncation
  await seedTestData();

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3000";

  console.log("E2E test environment ready");
  return { browser, page, baseUrl };
}

export async function teardown(context: TestContext): Promise<void> {
  console.log("Tearing down e2e test environment...");
  await context.browser.close();
}

export async function loginAsAdmin(context: TestContext): Promise<void> {
  const { page, baseUrl } = context;

  // Navigate to home page (login is a modal on the home page)
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle0", timeout: 15000 });

  // Wait for the page to load
  try {
    // Click admin button to open login modal
    const adminButton = await page.$('button[title="Admin"]');
    if (!adminButton) {
      console.log("Admin button not found - might already be logged in or page not loaded");
      return;
    }
    await adminButton.click();
    await new Promise(resolve => setTimeout(resolve, 500));

    // Fill in admin credentials
    const passwordInput = await page.$('input[type="password"], input[name="password"]');
    if (!passwordInput) {
      console.log("Password input not found in login modal");
      return;
    }
    await passwordInput.type(process.env.ADMIN_PASSWORD || "changeme");

    // Submit form by clicking the Unlock button (which has type="submit")
    const submitButton = await page.$('button[type="submit"]');
    if (!submitButton) {
      console.log("Submit button not found in login modal");
      return;
    }
    await submitButton.click();
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verify login succeeded by checking for New article button
    const newArticleBtn = await page.$('button[title="New article"]');
    if (newArticleBtn) {
      console.log("Admin login successful");
    } else {
      console.log("Admin login may have failed - New article button not found");
    }
  } catch (error) {
    // If login fails, might be because setup is not complete or already logged in
    console.log("Login attempt failed or not needed:", error);
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
      content: "<p>This is the first test article content.</p>",
      published: true,
    },
    {
      slug: "test-article-2",
      title: "Test Article 2",
      content: "<p>This is the second test article content.</p>",
      published: true,
    },
    {
      slug: "test-article-3",
      title: "Test Article 3",
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
