import puppeteer, { Browser, Page } from "puppeteer";
import { PrismaClient } from "@prisma/client";
import { spawn } from "child_process";
import { config } from "dotenv";

// Load test environment variables
config({ path: ".env.test" });

const prisma = new PrismaClient();

let devServer: ReturnType<typeof spawn> | null = null;

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
  
  // Start dev server if not already running
  if (!devServer) {
    console.log("Starting dev server for e2e tests...");
    devServer = spawn("bun", ["run", "dev"], {
      cwd: process.cwd(),
      stdio: "pipe",
      env: { ...process.env, NODE_ENV: "development" },
    });

    // Wait for server to be ready
    await new Promise<void>((resolve, reject) => {
      let ready = false;
      const timeout = setTimeout(() => {
        if (!ready) {
          console.error("Server startup timeout");
          reject(new Error("Server startup timeout"));
        }
      }, 30000);

      if (devServer) {
        if (devServer.stdout) {
          devServer.stdout.on("data", (data) => {
            const output = data.toString();
            if (output.includes("Ready in")) {
              ready = true;
              clearTimeout(timeout);
              console.log("Dev server ready");
              resolve();
            }
          });
        }

        if (devServer.stderr) {
          devServer.stderr.on("data", (data) => {
            const output = data.toString();
            if (output.includes("Ready in")) {
              ready = true;
              clearTimeout(timeout);
              console.log("Dev server ready");
              resolve();
            }
          });
        }

        devServer.on("error", (err) => {
          clearTimeout(timeout);
          console.error("Server error:", err);
          reject(err);
        });
      }
    });
  }

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
  
  // Stop dev server
  if (devServer) {
    console.log("Stopping dev server...");
    devServer.kill("SIGTERM");
    devServer = null;
  }
}

export async function loginAsAdmin(context: TestContext): Promise<void> {
  const { page, baseUrl } = context;
  
  // Navigate to home page (login is a modal on the home page)
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle0", timeout: 10000 });
  
  // Wait for the page to load
  try {
    // Click admin button to open login modal
    const adminButton = await page.$('button[title="Admin"]');
    if (adminButton) {
      await adminButton.click();
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Fill in admin credentials
      const passwordInput = await page.$('input[type="password"], input[name="password"]');
      if (passwordInput) {
        await passwordInput.type(process.env.ADMIN_PASSWORD || "changeme");
        
        // Submit form
        const submitButton = await page.$('button[type="submit"]');
        if (submitButton) {
          await submitButton.click();
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
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
