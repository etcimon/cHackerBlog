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

async function waitForEmbeds(page: Page, timeout = 15000): Promise<void> {
  const embedCount = await page.evaluate(() => {
    return document.querySelectorAll('[data-embed="1"]').length;
  });
  if (embedCount === 0) return;
  console.log(`Found ${embedCount} embed(s), waiting for them to load...`);

  // Remove loading="lazy" from all iframes so they start fetching immediately
  await page.evaluate(() => {
    document.querySelectorAll('iframe[loading="lazy"]').forEach((el) => {
      el.removeAttribute('loading');
    });
  });

  // Scroll through the page in steps to trigger lazy-loaded content and iframes
  const totalHeight = await page.evaluate(() => document.body.scrollHeight);
  const step = 800;
  for (let y = 0; y < totalHeight; y += step) {
    await page.evaluate((offset) => window.scrollTo(0, offset), y);
    await sleep(300);
  }
  // Scroll back to top for the screenshot
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(500);

  // Use CDP to wait for all frames to finish loading (cross-origin iframes
  // don't fire load events in the page context, so page.evaluate is unreliable)
  const client = await page.target().createCDPSession();
  const frameIds = new Set<string>();
  let loadedCount = 0;

  // Collect all child frame IDs via CDP frame tree
  const { frameTree } = await client.send('Page.getFrameTree');
  const mainFrameId = frameTree.frame.id;
  const collectFrameIds = (node: any) => {
    if (node.frame && node.frame.id !== mainFrameId) {
      frameIds.add(node.frame.id);
    }
    (node.childFrames || []).forEach(collectFrameIds);
  };
  collectFrameIds(frameTree);

  const allLoaded = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeout);
    if (frameIds.size === 0) { clearTimeout(timer); resolve(); return; }
    client.on('Page.frameStoppedLoading', ({ frameId }: { frameId: string }) => {
      if (frameIds.has(frameId)) {
        loadedCount++;
        if (loadedCount >= frameIds.size) {
          clearTimeout(timer);
          resolve();
        }
      }
    });
  });

  await allLoaded;
  console.log(`Embed frames loaded (${loadedCount}/${frameIds.size})`);

  // Give embeds a moment to render their content after load
  await sleep(2000);
  console.log('Embeds ready');
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
    await page.goto(`${baseUrl}`, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Wait for article cards to render (feed loads client-side via API)
    console.log("Waiting for articles to load...");
    try {
      await page.waitForSelector('[data-testid="article-card"]', { timeout: 15000 });
      console.log("Articles detected");
    } catch {
      console.log("No articles found within timeout - taking screenshot anyway");
    }

    // Wait for embedded elements (YouTube, SoundCloud, etc.) to load
    await waitForEmbeds(page);

    // Wait for the top-right language switcher to appear (gated behind
    // showTopRight which requires >1 article card in the DOM)
    console.log("Waiting for language switcher to appear...");
    try {
      await page.waitForSelector("select", { timeout: 10000 });
      console.log("Language switcher detected");
    } catch {
      console.log("Language switcher not found within timeout");
    }

    // Take screenshot of home page (viewport only, not full page)
    console.log("Taking screenshot of home page...");
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "blog-home.png"),
      fullPage: false,
    });

    // Login as admin
    console.log("Logging in as admin...");
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
          // Wait for the page to reload after login (admin-bar calls window.location.reload)
          await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {
            console.log("Navigation event not detected, continuing...");
          });
          await sleep(1000);
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

    // No need to re-navigate — the login flow already reloaded the page
    console.log("Page reloaded after login, checking state...");
    await sleep(2000);

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

    // Wait for articles to reload after login
    console.log("Waiting for articles to reload after login...");
    try {
      await page.waitForSelector('[data-testid="article-card"]', { timeout: 15000 });
      console.log("Articles detected after login");
    } catch {
      console.log("No articles found after login - taking debug screenshot");
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "debug-after-login.png"),
        fullPage: true,
      });
    }

    // Scroll to the first article and click its edit button
    console.log("Scrolling to first article...");
    const firstArticle = await page.$('[data-testid="article-card"]');
    if (firstArticle) {
      await firstArticle.evaluate((el) => el.scrollIntoView({ block: "start" }));
      await sleep(500);

      // Find the edit button within the first article
      const editButton = await firstArticle.$('button[title="Edit article"]');
      if (editButton) {
        console.log("Found edit button on first article, clicking...");
        await editButton.click();
        await sleep(1500);

        // Take screenshot of edit modal
        console.log("Taking screenshot of edit modal...");
        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, "edit-modal.png"),
          fullPage: false,
        });
      } else {
        console.log("Edit button not found on first article - trying New Article button...");
        let newArticleButton = await page.$('button[title="New article"]');
        if (newArticleButton) {
          await newArticleButton.click();
          await sleep(1500);
          console.log("Taking screenshot of edit modal...");
          await page.screenshot({
            path: path.join(SCREENSHOT_DIR, "edit-modal.png"),
            fullPage: false,
          });
        } else {
          console.log("New Article button not found - taking debug screenshot");
          await page.screenshot({
            path: path.join(SCREENSHOT_DIR, "debug-after-login.png"),
            fullPage: true,
          });
        }
      }
    } else {
      console.log("No article card found - taking debug screenshot");
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "debug-after-login.png"),
        fullPage: true,
      });
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
