/**
 * Unified API error handling and response envelope.
 *
 * Goals:
 *  - One JSON shape for every API response so the client can drive toasts.
 *  - Development: include stack/trace + raw detail for debugging.
 *  - Production: expose only user-centric text (HTTP status reason or flattened
 *    zod validation messages), never internal stack traces.
 *
 * Client (toast.ts) reads `error.message` for user display and, in dev,
 * `error.trace` for console diagnostics.
 */
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { isProd } from "@/lib/env";
import { createLogger } from "@/lib/logger";

const log = createLogger("api");

export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = {
  ok: false;
  error: {
    code: string;
    status: number;
    message: string;
    /** Field-level zod messages, keyed by path. */
    fields?: Record<string, string[]>;
    /** Only populated in development. */
    trace?: string;
  };
};
export type ApiResponse<T> = ApiOk<T> | ApiErr;

/** Throwable error carrying an HTTP status and a user-safe message. */
export class AppError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = "BAD_REQUEST") {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
  }
}

export const Errors = {
  unauthorized: (msg = "Authentication required") =>
    new AppError(msg, 401, "UNAUTHORIZED"),
  forbidden: (msg = "Forbidden") => new AppError(msg, 403, "FORBIDDEN"),
  notFound: (msg = "Not found") => new AppError(msg, 404, "NOT_FOUND"),
  rateLimited: (msg = "Too many requests") =>
    new AppError(msg, 429, "RATE_LIMITED"),
  conflict: (msg = "Conflict") => new AppError(msg, 409, "CONFLICT"),
};

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json<ApiOk<T>>({ ok: true, data }, { status });
}

/**
 * Convert any thrown value into the standard error envelope. Logs full detail
 * server-side regardless of environment; only leaks safe text to the client in
 * production.
 */
export function fail(err: unknown): NextResponse {
  // Validation errors -> 422 with field messages.
  if (err instanceof ZodError) {
    const fields = err.flatten().fieldErrors as Record<string, string[]>;
    log.warn("validation error:", fields);
    return NextResponse.json<ApiErr>(
      {
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          status: 422,
          message: "Validation failed",
          fields,
          ...(isProd ? {} : { trace: err.stack }),
        },
      },
      { status: 422 },
    );
  }

  if (err instanceof AppError) {
    log.warn(`${err.code} (${err.status}): ${err.message}`);
    return NextResponse.json<ApiErr>(
      {
        ok: false,
        error: {
          code: err.code,
          status: err.status,
          message: err.message,
          ...(isProd ? {} : { trace: err.stack }),
        },
      },
      { status: err.status },
    );
  }

  // Unknown / unexpected: log fully, but hide internals in production.
  const e = err as Error;
  log.error("unhandled error:", e?.stack ?? e);
  return NextResponse.json<ApiErr>(
    {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        status: 500,
        message: isProd ? "Internal server error" : e?.message ?? "Unknown error",
        ...(isProd ? {} : { trace: e?.stack }),
      },
    },
    { status: 500 },
  );
}

/** Wrap a route handler so thrown AppError/ZodError become envelopes. */
export function handler<T>(
  fn: (req: Request, ctx: T) => Promise<NextResponse>,
): (req: Request, ctx: T) => Promise<NextResponse> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      return fail(err);
    }
  };
}
