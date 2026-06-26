import puppeteer, { Browser, Page } from "puppeteer";
import path from "path";
import fs from "fs";
import { config } from "dotenv";

// Load .env file
config();

const SCREENSHOT_DIR = path.join(process.cwd(), "screenshots");

// Ensure screenshot directory exists
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function takeScreenshots() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  
  // Set desktop viewport to ensure admin button is visible
  await page.setViewport({ width: 1920, height: 1080 });
  
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
    await sleep(2000);

    // Click admin button to open login modal
    console.log("Looking for admin button...");
    let adminButton = await page.$('button[title="Admin"]');
    if (!adminButton) {
      // Fallback: look for button containing "Admin" text using evaluate
      const adminButtonExists = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.find(btn => btn.textContent?.includes('Admin'));
      });
      if (adminButtonExists) {
        adminButton = await page.$('button[title="Admin"]');
      }
    }
    
    if (adminButton) {
      console.log("Found admin button, clicking...");
      await adminButton.click();
      await sleep(1000);

      // Enter password
      const passwordInput = await page.$('input[type="password"]');
      if (passwordInput) {
        console.log("Entering password...");
        await passwordInput.type(adminPassword);
        
        // Submit by clicking the Unlock button
        const unlockButtonClicked = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const unlockBtn = buttons.find(btn => btn.textContent?.includes('Unlock'));
          if (unlockBtn) {
            (unlockBtn as HTMLButtonElement).click();
            return true;
          }
          return false;
        });
        if (unlockButtonClicked) {
          console.log("Unlock button clicked");
          await sleep(3000);
        } else {
          console.log("Unlock button not found");
        }
      } else {
        console.log("Password input not found");
      }
    } else {
      console.log("Admin button not found - taking debug screenshot");
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "debug-admin-button.png"),
        fullPage: true,
      });
    }

    // Wait for page to reload after login
    console.log("Waiting for page to reload after login...");
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle0", timeout: 10000 });
    await sleep(3000);

    // Check if we're still seeing the Admin button (not logged in) or admin toolbar (logged in)
    const adminButtonAfterLogin = await page.$('button[title="Admin"]');
    const newArticleButtonCheck = await page.$('button[title="New article"]');
    
    if (adminButtonAfterLogin) {
      console.log("Still seeing Admin button - login may have failed");
    } else if (newArticleButtonCheck) {
      console.log("Seeing New Article button - login successful");
    } else {
      console.log("Neither Admin nor New Article button found - unexpected state");
    }

    // Wait for admin toolbar to appear (it should be visible after successful login)
    console.log("Waiting for admin toolbar to appear...");
    try {
      await page.waitForSelector('button[title="New article"]', { timeout: 5000 });
      console.log("Admin toolbar detected");
    } catch (e) {
      console.log("Admin toolbar not detected within timeout, continuing anyway");
    }

    // Look for edit button on articles first
    console.log("Looking for edit button on articles...");
    let editButton = await page.$('button[title="Edit article"]');
    if (editButton) {
      console.log("Found edit button, clicking...");
      await editButton.click();
      await sleep(1000);

      // Take screenshot of edit modal
      console.log("Taking screenshot of edit modal...");
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "edit-modal.png"),
        fullPage: false,
      });
    } else {
      console.log("No edit button found - trying New Article button instead...");
      // Try clicking the "New Article" button from AdminBar
      let newArticleButton = await page.$('button[title="New article"]');
      if (!newArticleButton) {
        // Fallback: look for button containing "New article" text
        const newArticleExists = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          return buttons.find(btn => btn.textContent?.includes('New article'));
        });
        if (newArticleExists) {
          newArticleButton = await page.$('button[title="New article"]');
        }
      }
      
      if (newArticleButton) {
        console.log("Found New Article button, clicking...");
        await newArticleButton.click();
        await sleep(1000);

        // Take screenshot of edit modal
        console.log("Taking screenshot of edit modal...");
        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, "edit-modal.png"),
          fullPage: false,
        });
      } else {
        console.log("New Article button not found - taking debug screenshot");
        // Debug: take a screenshot of what we see
        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, "debug-after-login.png"),
          fullPage: true,
        });
      }
    }

    console.log("Screenshots saved to:", SCREENSHOT_DIR);
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log("Taking screenshots...");
  console.log("Make sure the dev server is running: bun run dev");
  await takeScreenshots();
  console.log("Done!");
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
