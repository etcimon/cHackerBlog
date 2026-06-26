import puppeteer, { Browser, Page } from "puppeteer";
import { PrismaClient } from "@prisma/client";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { config } from "dotenv";

// Load .env file
config();

const prisma = new PrismaClient();

const SCREENSHOT_DIR = path.join(process.cwd(), "screenshots");

// Ensure screenshot directory exists
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function setupBlog() {
  // Ensure setup is marked as complete
  await prisma.siteSettings.upsert({
    where: { id: 1 },
    update: { setupComplete: true },
    create: {
      id: 1,
      title: "cHackerBlog",
      description: "A self-hosted, themable, API-interactive, infinite-scroll blogging platform",
      authorName: "Cimon",
      setupComplete: true,
    },
  });

  // Create a test article if none exists
  const existingArticle = await prisma.article.findFirst();
  if (!existingArticle) {
    await prisma.article.create({
      data: {
        slug: "welcome-to-chackerblog",
        title: "Welcome to cHackerBlog",
        content: "<p>This is a demo article showcasing the cHackerBlog platform. It features a WYSIWYG editor, infinite scroll, and a hacker terminal aesthetic.</p><h2>Features</h2><ul><li>WYSIWYG Editor</li><li>Infinite Scroll Feed</li><li>Article Pinning</li><li>Multi-language Support</li><li>Comment System</li></ul>",
        published: true,
      },
    });
  }

  console.log("Blog setup complete");
}

async function startDevServer(): Promise<() => void> {
  console.log("Starting dev server...");
  const server = spawn("bun", ["run", "dev"], {
    cwd: process.cwd(),
    stdio: "pipe",
  });

  // Wait for server to be ready
  await new Promise<void>((resolve, reject) => {
    let ready = false;
    const timeout = setTimeout(() => {
      if (!ready) reject(new Error("Server startup timeout"));
    }, 30000);

    server.stdout.on("data", (data) => {
      const output = data.toString();
      if (output.includes("Ready in")) {
        ready = true;
        clearTimeout(timeout);
        resolve();
      }
    });

    server.stderr.on("data", (data) => {
      const output = data.toString();
      if (output.includes("Ready in")) {
        ready = true;
        clearTimeout(timeout);
        resolve();
      }
    });

    server.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  console.log("Dev server started");

  // Return cleanup function
  return () => {
    console.log("Stopping dev server...");
    server.kill("SIGTERM");
  };
}

async function takeScreenshots() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3000";
  const adminPassword = process.env.ADMIN_PASSWORD || "changeme";

  try {
    console.log("Navigating to home page...");
    await page.goto(`${baseUrl}`, { waitUntil: "networkidle0", timeout: 30000 });

    // Wait for content to load
    await page.waitForSelector("body", { timeout: 10000 });

    // Take screenshot of home page
    console.log("Taking screenshot of home page...");
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "blog-home.png"),
      fullPage: true,
    });

    // Login as admin
    console.log("Logging in as admin...");
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle0", timeout: 10000 });

    // Click admin button to open login modal
    const adminButton = await page.$('button[title="Admin"]');
    if (adminButton) {
      await adminButton.click();
      await sleep(500);

      // Enter password
      const passwordInput = await page.$('input[type="password"]');
      if (passwordInput) {
        await passwordInput.type(adminPassword);
        
        // Submit
        const submitButton = await page.$('button[type="submit"]');
        if (submitButton) {
          await submitButton.click();
          await sleep(2000);
        }
      }
    }

    // Wait for page to reload after login
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle0", timeout: 10000 });
    await sleep(1000);

    // Click on an article to open edit modal
    const articleCard = await page.$('[data-testid="article-card"]');
    if (articleCard) {
      await articleCard.click();
      await sleep(500);

      // Look for edit button
      const editButton = await page.$('button[title="Edit article"]');
      if (editButton) {
        await editButton.click();
        await sleep(1000);

        // Take screenshot of edit modal
        console.log("Taking screenshot of edit modal...");
        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, "edit-modal.png"),
          fullPage: false,
        });
      }
    }

    console.log("Screenshots saved to:", SCREENSHOT_DIR);
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log("Setting up blog for screenshots...");
  await setupBlog();
  
  let cleanupServer: (() => void) | null = null;
  try {
    cleanupServer = await startDevServer();
    
    console.log("Taking screenshots...");
    await takeScreenshots();
  } finally {
    if (cleanupServer) {
      cleanupServer();
    }
    await prisma.$disconnect();
    console.log("Done!");
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
