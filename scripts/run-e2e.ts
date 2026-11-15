/**
 * Global E2E test runner.
 * Starts the test server once, runs all E2E tests, then stops the server.
 * This prevents port conflicts and ensures consistent server state across all tests.
 */
import { spawn, ChildProcess } from "child_process";
import { connect } from "net";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync, mkdirSync, readdirSync, writeFileSync, unlinkSync } from "fs";
import { config } from "dotenv";

// The developer's .env (auto-loaded by bun) must not leak into the test
// server: layer .env.test under the explicit overrides in each spawned env.
// Parsed into a scratch object — mutating process.env would clobber values
// the test files read (e.g. .env.test's ADMIN_PASSWORD=changeme vs the
// harness's test-password).
const { parsed: envTest } = config({ path: ".env.test", processEnv: {} });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let serverProcess: ChildProcess | null = null;
const SERVER_PORT = 3001;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;
const LOCK_FILE = join(__dirname, "..", ".test-server.lock");

// E2E files that need per-file server env (FEED_* etc.) run in their own
// phase without the shared server — setup() starts/stops a dedicated server
// per describe block.
const OWN_SERVER_TESTS = ["tests/e2e/feed-loading.test.ts"];

interface StartOptions {
  mode?: "dev" | "prod";
}

function isServerRunning(): boolean {
  return existsSync(LOCK_FILE);
}

function createLockFile(): void {
  const lockDir = dirname(LOCK_FILE);
  if (!existsSync(lockDir)) {
    mkdirSync(lockDir, { recursive: true });
  }
  writeFileSync(LOCK_FILE, process.pid.toString());
}

function removeLockFile(): void {
  if (existsSync(LOCK_FILE)) {
    unlinkSync(LOCK_FILE);
  }
}

async function startTestServer(options: StartOptions = {}): Promise<string> {
  if (isServerRunning()) {
    console.log("Test server already running (detected via lock file)");
    try {
      await fetch(SERVER_URL, { method: "HEAD" });
      return SERVER_URL;
    } catch {
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

  const command = mode === "prod" ? "start" : "dev";
  const args = ["run", command];

  serverProcess = spawn("bun", args, {
    cwd: join(__dirname, ".."),
    stdio: "pipe",
    // On POSIX, become a process-group leader so cleanup can kill the whole
    // tree (bun wrapper + next-server child) via process.kill(-pid).
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      ...envTest,
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

  serverProcess.stdout?.on("data", (data) => {
    const output = data.toString();
    if (output.includes("ready") || output.includes("started") || output.includes("listening")) {
      console.log("Test server ready");
    }
  });

  serverProcess.stderr?.on("data", (data) => {
    console.error("Test server error:", data.toString());
  });

  await waitForServerReady(SERVER_URL);
  console.log(`Test server running at ${SERVER_URL}`);

  createLockFile();
  return SERVER_URL;
}

async function stopTestServer(): Promise<void> {
  if (!serverProcess) {
    console.log("No test server running in this process");
    removeLockFile();
    return;
  }

  console.log("Stopping test server...");
  const pid = serverProcess.pid;

  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      console.log("Test server stopped");
      resolve();
    };

    serverProcess?.on("exit", done);

    // Kill the entire process tree; the `bun run dev` wrapper spawns a
    // detached next-server child that a plain kill() would orphan (holding
    // port 3001 and blocking the next run).
    if (pid) {
      if (process.platform === "win32") {
        spawn("taskkill", ["/F", "/T", "/PID", pid.toString()], { stdio: "ignore" });
      } else {
        try {
          process.kill(-pid, "SIGTERM");
        } catch {
          serverProcess?.kill("SIGTERM");
        }
      }
    } else {
      serverProcess?.kill("SIGTERM");
    }

    // Hard-stop fallback so cleanup never blocks longer than needed.
    setTimeout(() => {
      try {
        serverProcess?.kill("SIGKILL");
      } catch {
        // already gone
      }
      done();
    }, 4000);
  });

  serverProcess = null;
  removeLockFile();

  // The killed tree can keep the socket briefly; the own-server phase starts
  // a fresh server on the same port and must not hit EADDRINUSE.
  await waitForPortFree(SERVER_PORT);
}

/** Poll a TCP connect until the port is free (or ~10s elapses). */
async function waitForPortFree(port: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const inUse = await new Promise<boolean>((resolve) => {
      const sock = connect({ host: "127.0.0.1", port });
      sock.once("connect", () => {
        sock.destroy();
        resolve(true);
      });
      sock.once("error", () => resolve(false));
      sock.setTimeout(1000, () => {
        sock.destroy();
        resolve(false);
      });
    });
    if (!inUse) return;
    await new Promise((r) => setTimeout(r, 200));
  }
}

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
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  clearTimeout(timeout);
  throw new Error(`Server not ready after ${maxAttempts} attempts`);
}

async function runE2ETests(): Promise<void> {
  const mode = process.env.NODE_ENV === "production" ? "prod" : "dev";
  const projectRoot = join(__dirname, "..");
  const testEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: mode === "prod" ? "production" : "test",
    DATABASE_PROVIDER: "sqlite",
    DATABASE_URL: "file:./test.sqlite",
    // In-memory cache/KV: Redis is never imported or connected (see kv.ts).
    CACHE_DRIVER: "memory",
    REDIS_KEY_PREFIX: "test:",
    SESSION_SECRET: "test-secret-for-e2e",
    ADMIN_PASSWORD: "test-password",
    LOG_LEVEL: "error",
  };

  const runPhase = (files: string[], label: string): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      console.log(`Running ${label}...`);
      const testProcess = spawn("bun", ["test", ...files], {
        cwd: projectRoot,
        stdio: "inherit",
        env: testEnv,
      });
      testProcess.on("exit", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`${label} failed with exit code ${code}`));
        }
      });
    });

  // Phase 1: every e2e file except the own-server ones, against the shared
  // server started below.
  const sharedFiles = readdirSync(join(projectRoot, "tests", "e2e"))
    .filter((f) => f.endsWith(".test.ts"))
    .map((f) => `tests/e2e/${f}`)
    .filter((f) => !OWN_SERVER_TESTS.includes(f))
    .sort();

  let failure: Error | null = null;
  try {
    await startTestServer({ mode });
    try {
      await runPhase(sharedFiles, "shared-server E2E tests");
    } catch (err) {
      failure = err as Error;
      console.error(err);
    }
  } finally {
    await stopTestServer();
  }

  // Phase 2: own-server files manage their own server env per describe.
  try {
    await runPhase(OWN_SERVER_TESTS, "own-server E2E tests");
  } catch (err) {
    failure = failure ?? (err as Error);
    console.error(err);
  }

  if (failure) throw failure;
  console.log("E2E tests passed");
}

// Handle process termination
process.on("SIGINT", async () => {
  await stopTestServer();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await stopTestServer();
  process.exit(0);
});

// Run the tests. Explicitly exit so lingering child-process handles from the
// spawned server don't keep the event loop alive after cleanup completes.
runE2ETests()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("E2E test runner failed:", error);
    process.exit(1);
  });
