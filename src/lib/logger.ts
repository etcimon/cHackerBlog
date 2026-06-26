/**
 * Structured logging service (server-side). Provides leveled logging
 * (trace < debug < info < warn < error) with optional file output and console
 * output, both configurable via env (LOG_LEVEL, LOG_TO_FILE, LOG_DIR,
 * LOG_FILE, LOG_TO_CONSOLE).
 *
 * Every module gets a *scoped* logger via `createLogger("redis")`, which tags
 * each line with its scope. File writes are appended through a serialized queue
 * so ordering is preserved even under concurrency. This module is server-only
 * (it touches the filesystem); client code uses the toast system / console.
 *
 * Tests import the logger directly and can point LOG_DIR at a temp folder to
 * assert file output and level filtering.
 */
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const PRIORITY: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  silent: 100,
};

interface LoggerConfig {
  level: LogLevel;
  toConsole: boolean;
  toFile: boolean;
  filePath: string;
}

/**
 * Resolve config lazily from process.env (NOT from lib/env) to avoid a circular
 * dependency: lib/env is allowed to log validation problems. Defaults are safe.
 */
function resolveConfig(): LoggerConfig {
  const level = (process.env.LOG_LEVEL as LogLevel) || "info";
  const dir = process.env.LOG_DIR || "./logs";
  const file = process.env.LOG_FILE || "app.log";
  return {
    level: LOG_LEVELS.includes(level) ? level : "info",
    toConsole: process.env.LOG_TO_CONSOLE !== "false",
    toFile: process.env.LOG_TO_FILE !== "false",
    filePath: path.isAbsolute(file) ? file : path.join(dir, file),
  };
}

let config = resolveConfig();

/** Re-read env-based config (used by tests after mutating process.env). */
export function reconfigureLogger(): void {
  config = resolveConfig();
}

// Serialized append queue: chain writes so log lines never interleave.
let writeChain: Promise<void> = Promise.resolve();
let dirEnsured = false;

function enqueueFileWrite(line: string): void {
  writeChain = writeChain
    .then(async () => {
      if (!dirEnsured) {
        await mkdir(path.dirname(config.filePath), { recursive: true });
        dirEnsured = true;
      }
      await appendFile(config.filePath, line + "\n", "utf8");
    })
    .catch(() => {
      // Never let logging failures crash the app.
    });
}

/** Flush any pending file writes (await in tests before asserting on the file). */
export function flushLogs(): Promise<void> {
  return writeChain;
}

function serialize(value: unknown): string {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function emit(level: LogLevel, scope: string, args: unknown[]): void {
  if (PRIORITY[level] < PRIORITY[config.level]) return;

  const timestamp = new Date().toISOString();
  const message = args.map(serialize).join(" ");
  const line = `${timestamp} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`;

  if (config.toConsole) {
    const fn =
      level === "error"
        ? console.error
        : level === "warn"
          ? console.warn
          : console.log;
    fn(line);
  }
  if (config.toFile) enqueueFileWrite(line);
}

export interface Logger {
  trace: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  child: (subScope: string) => Logger;
}

export function createLogger(scope: string): Logger {
  return {
    trace: (...args) => emit("trace", scope, args),
    debug: (...args) => emit("debug", scope, args),
    info: (...args) => emit("info", scope, args),
    warn: (...args) => emit("warn", scope, args),
    error: (...args) => emit("error", scope, args),
    child: (subScope) => createLogger(`${scope}:${subScope}`),
  };
}

/** Default application-scoped logger. */
export const logger = createLogger("app");
