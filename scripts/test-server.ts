/**
 * Test server helper for E2E tests.
 * Starts the Next.js server in the background and provides cleanup.
 * Supports both dev and production modes.
 * Uses a singleton pattern to prevent multiple server instances.
 */
import { spawn, ChildProcess } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let serverProcess: ChildProcess | null = null;
export const SERVER_PORT = 3001;
export const SERVER_URL = `http://localhost:${SERVER_PORT}`;
const LOCK_FILE = join(__dirname, "..", ".test-server.lock");

interface StartOptions {
  mode?: "dev" | "prod";
}

/**
 * Check if the lock file exists (indicates server is already running)
 */
export function isServerRunning(): boolean {
  return existsSync(LOCK_FILE);
}

/**
 * Create a lock file to indicate server is running
 */
function createLockFile(): void {
  const lockDir = dirname(LOCK_FILE);
  if (!existsSync(lockDir)) {
    mkdirSync(lockDir, { recursive: true });
  }
  writeFileSync(LOCK_FILE, process.pid.toString());
}

/**
 * Remove the lock file
 */
function removeLockFile(): void {
  if (existsSync(LOCK_FILE)) {
    unlinkSync(LOCK_FILE);
  }
}

/**
 * Start the Next.js server for E2E testing.
 * Returns the server URL once the server is ready.
 * Uses a singleton pattern - if server is already running, returns the URL immediately.
 */
export async function startTestServer(options: StartOptions = {}): Promise<string> {
  // Check if server is already running via lock file
  if (isServerRunning()) {
    console.log("Test server already running (detected via lock file)");
    // Verify it's actually responding
    try {
      await fetch(SERVER_URL, { method: "HEAD" });
      return SERVER_URL;
    } catch {
      // Server not responding, clean up lock file and start fresh
      console.log("Lock file exists but server not responding, cleaning up...");
      removeLockFile();
    }
  }

  if (serverProcess) {
    console.log("Test server already running in this process");
    return SERVER_URL;
  }

  const { mode = "dev" } = options;
  console.log(`Starting Next.js test server in ${mode} mode...`);

  // Determine command based on mode
  const command = mode === "prod" ? "start" : "dev";
  const args = ["run", command];

  // Start the server
  serverProcess = spawn("bun", args, {
    cwd: join(__dirname, ".."),
    stdio: "pipe",
    env: {
      ...process.env,
      NODE_ENV: mode === "prod" ? "production" : "test",
      PORT: SERVER_PORT.toString(),
      DATABASE_PROVIDER: "sqlite",
      DATABASE_URL: "file:./test.sqlite",
      // In-memory cache/KV: Redis is never imported or connected (see kv.ts).
      CACHE_DRIVER: "memory",
      REDIS_KEY_PREFIX: "test:",
      SESSION_SECRET: "test-secret-for-e2e",
      ADMIN_PASSWORD: "test-password",
      LOG_LEVEL: "error",
    },
  });

  // Log server output for debugging
  serverProcess.stdout?.on("data", (data) => {
    const output = data.toString();
    if (output.includes("ready") || output.includes("started") || output.includes("listening")) {
      console.log("Test server ready");
    }
  });

  serverProcess.stderr?.on("data", (data) => {
    console.error("Test server error:", data.toString());
  });

  // Wait for server to be ready
  await waitForServerReady(SERVER_URL);
  console.log(`Test server running at ${SERVER_URL}`);

  // Create lock file
  createLockFile();

  return SERVER_URL;
}

/**
 * Stop the test server.
 */
export async function stopTestServer(): Promise<void> {
  if (!serverProcess) {
    console.log("No test server running in this process");
    // Still clean up lock file if it exists
    removeLockFile();
    return;
  }

  console.log("Stopping test server...");
  serverProcess.kill("SIGTERM");
  
  // Wait for process to exit
  await new Promise<void>((resolve) => {
    serverProcess?.on("exit", () => {
      console.log("Test server stopped");
      resolve();
    });
    
    // Force kill after 5 seconds
    setTimeout(() => {
      if (serverProcess) {
        serverProcess.kill("SIGKILL");
        resolve();
      }
    }, 5000);
  });

  serverProcess = null;
  removeLockFile();
}

/**
 * Wait for the server to be ready by polling the health endpoint.
 */
async function waitForServerReady(url: string, maxAttempts = 30): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        method: "HEAD",
      });
      if (response.ok) {
        clearTimeout(timeout);
        return;
      }
    } catch (error) {
      // Server not ready yet, wait and retry
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  clearTimeout(timeout);
  throw new Error(`Server not ready after ${maxAttempts} attempts`);
}

/**
 * Handle process termination signals to clean up the server.
 */
if (process.env.NODE_ENV !== "test") {
  process.on("SIGINT", async () => {
    await stopTestServer();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await stopTestServer();
    process.exit(0);
  });
}
