import { spawn } from "child_process";
import net from "net";
import { config } from "dotenv";

// Load test environment variables
config({ path: ".env.test" });

let devServer: ReturnType<typeof spawn> | null = null;
const TEST_PORT = 3000;

// Check if a port is available
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}

// Wait for port to be ready
function waitForPort(port: number, timeout = 30000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const check = () => {
      const socket = net.createConnection(port, "localhost");
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        if (Date.now() - startTime > timeout) {
          reject(new Error(`Port ${port} not ready after ${timeout}ms`));
        } else {
          setTimeout(check, 500);
        }
      });
    };
    check();
  });
}

// Store the dev server reference for global teardown
(global as any).__devServer = null;

export default async function globalSetup() {
  console.log('='.repeat(80));
  console.log('Starting test suite...');
  console.log('='.repeat(80));

  // Log environment information for debugging
  console.log('NODE_ENV:', process.env.NODE_ENV);
  console.log('DATABASE_URL:', process.env.DATABASE_URL ? '***SET***' : 'NOT SET');
  console.log('CACHE_DRIVER:', process.env.CACHE_DRIVER || 'NOT SET');
  console.log('THEME:', process.env.THEME || 'NOT SET');
  console.log('='.repeat(80));

  // Start dev server if port is available
  const portAvailable = await isPortAvailable(TEST_PORT);
  if (!portAvailable) {
    console.log(`Port ${TEST_PORT} is already in use, assuming dev server is running`);
  } else {
    console.log("Starting dev server for e2e tests...");
    devServer = spawn("bun", ["run", "dev"], {
      cwd: process.cwd(),
      stdio: "pipe",
      env: { ...process.env, NODE_ENV: "development" },
    });

    // Store for global teardown
    (global as any).__devServer = devServer;

    // Wait for server to be ready by checking the port
    try {
      await waitForPort(TEST_PORT, 30000);
      console.log("Dev server ready");
    } catch (err) {
      console.error("Server startup timeout:", err);
      if (devServer) {
        devServer.kill("SIGKILL");
      }
      throw err;
    }
  }
}
