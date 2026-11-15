/**
 * Test server helper for E2E tests.
 * Starts the Next.js server in the background and provides cleanup.
 * Supports both dev and production modes.
 * Uses a singleton pattern to prevent multiple server instances.
 */
import { spawn, ChildProcess } from "child_process";
import { connect } from "net";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "fs";
import { config } from "dotenv";

// The developer's .env (auto-loaded by bun) must not leak into the test
// server: layer .env.test under the explicit overrides in the spawned env.
// Parsed into a scratch object — mutating process.env would clobber values
// the test files read (e.g. .env.test's ADMIN_PASSWORD=changeme vs the
// harness's test-password).
const { parsed: envTest } = config({ path: ".env.test", processEnv: {} });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let serverProcess: ChildProcess | null = null;
export const SERVER_PORT = 3001;
export const SERVER_URL = `http://localhost:${SERVER_PORT}`;
// Password the spawned test server expects; e2e helpers import this so
// single-file runs work without ADMIN_PASSWORD in the invoking environment.
export const TEST_ADMIN_PASSWORD = "test-password";
const LOCK_FILE = join(__dirname, "..", ".test-server.lock");

interface StartOptions {
  mode?: "dev" | "prod";
  /** Extra env vars layered over .env.test (e.g. per-file FEED_* tuning). */
  env?: Record<string, string>;
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

  const { mode = "dev", env: extraEnv } = options;
  console.log(`Starting Next.js test server in ${mode} mode...`);

  // Never kill a process we did not start: if something already listens on
  // the test port (a dev server, a leftover from another run), fail fast
  // instead of spawning into EADDRINUSE or probing a foreign server.
  const portOwner = await portOwnerPid(SERVER_PORT);
  if (portOwner) {
    throw new Error(
      `Port ${SERVER_PORT} is already in use by PID ${portOwner}; stop that process (or a leftover test server) and re-run.`,
    );
  }

  // Determine command based on mode
  const command = mode === "prod" ? "start" : "dev";
  const args = ["run", command];

  // Start the server
  serverProcess = spawn("bun", args, {
    cwd: join(__dirname, ".."),
    stdio: "pipe",
    // On POSIX, become a process-group leader so cleanup can kill the whole
    // tree (bun wrapper + next-server child) via process.kill(-pid).
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      ...envTest,
      ...extraEnv,
      NODE_ENV: mode === "prod" ? "production" : "test",
      PORT: SERVER_PORT.toString(),
      DATABASE_PROVIDER: "sqlite",
      DATABASE_URL: "file:./test.sqlite",
      // In-memory cache/KV: Redis is never imported or connected (see kv.ts).
      CACHE_DRIVER: "memory",
      REDIS_KEY_PREFIX: "test:",
      SESSION_SECRET: "test-secret-for-e2e",
      ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
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

  // The killed wrapper can leave orphaned grandchildren (next-server) that
  // still hold the port — an immediate restart in the same process (per-file
  // env servers) must not hit EADDRINUSE. Kill whoever owns the port, then
  // wait for it to be released.
  const ownerPid = await portOwnerPid(SERVER_PORT);
  if (ownerPid) {
    if (process.platform === "win32") {
      spawn("taskkill", ["/F", "/T", "/PID", String(ownerPid)], {
        stdio: "ignore",
      });
    } else {
      try {
        process.kill(ownerPid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  }
  await waitForPortFree(SERVER_PORT);
}

/** PID listening on `port`, or null when the port is free/unreadable. */
async function portOwnerPid(port: number): Promise<number | null> {
  if (process.platform === "win32") {
    return new Promise((resolve) => {
      const p = spawn("netstat", ["-ano"], { stdio: ["ignore", "pipe", "ignore"] });
      let out = "";
      p.stdout.on("data", (d) => (out += d.toString()));
      p.on("close", () => {
        for (const line of out.split(/\r?\n/)) {
          const cols = line.trim().split(/\s+/);
          //   TCP  0.0.0.0:3001  0.0.0.0:0  LISTENING  20564
          if (cols.length >= 5 && cols[3] === "LISTENING") {
            const localPort = cols[1].split(":").pop();
            if (localPort === String(port)) {
              const pid = Number.parseInt(cols[4], 10);
              if (Number.isFinite(pid)) {
                resolve(pid);
                return;
              }
            }
          }
        }
        resolve(null);
      });
      p.on("error", () => resolve(null));
    });
  }
  // POSIX best-effort via lsof (the process-group kill above normally suffices).
  return new Promise((resolve) => {
    const p = spawn("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.on("close", () => {
      const pid = Number.parseInt(out.trim().split(/\s+/)[0] ?? "", 10);
      resolve(Number.isFinite(pid) ? pid : null);
    });
    p.on("error", () => resolve(null));
  });
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
