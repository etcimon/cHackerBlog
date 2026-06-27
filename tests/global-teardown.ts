import net from "net";

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

// Wait for port to be free
function waitForPortFree(port: number, timeout = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const check = async () => {
      const available = await isPortAvailable(port);
      if (available) {
        resolve();
      } else if (Date.now() - startTime > timeout) {
        reject(new Error(`Port ${port} not free after ${timeout}ms`));
      } else {
        setTimeout(check, 500);
      }
    };
    check();
  });
}

const TEST_PORT = 3000;

export default async function globalTeardown() {
  console.log('='.repeat(80));
  console.log('Test suite completed');
  console.log('='.repeat(80));

  // Stop dev server if it was started by global setup
  const devServer = (global as any).__devServer;
  if (devServer) {
    console.log("Stopping dev server...");

    // Try graceful shutdown first
    devServer.kill("SIGTERM");

    // Wait a bit for graceful shutdown
    await new Promise<void>((resolve) => setTimeout(resolve, 2000));

    // If still running, force kill
    if (devServer.pid && !devServer.killed) {
      console.log("Force killing dev server...");
      devServer.kill("SIGKILL");

      // On Windows, also try taskkill as a fallback
      if (process.platform === "win32") {
        try {
          const { execSync } = require("child_process");
          execSync(`taskkill /F /PID ${devServer.pid}`, { stdio: "ignore" });
        } catch (e) {
          // Ignore if process already terminated
        }
      }
    }

    // Wait for port to be free before returning
    try {
      await waitForPortFree(TEST_PORT, 10000);
      console.log("Port is now free");
    } catch (e) {
      console.log("Port still in use after shutdown, continuing anyway");
    }

    (global as any).__devServer = null;
  }
}
