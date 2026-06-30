/**
 * Client-side fetch wrapper that understands the API envelope (see lib/errors).
 * It unwraps `{ ok, data }`, and on `{ ok:false, error }` throws an ApiClientError
 * carrying the user-facing message + field errors so callers can fire toasts.
 *
 * In development it also surfaces the server `trace` to the console.
 */
import type { ApiResponse } from "@/lib/errors";

export class ApiClientError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string[]>;
  constructor(opts: {
    message: string;
    status: number;
    code: string;
    fields?: Record<string, string[]>;
    trace?: string;
  }) {
    super(opts.message);
    this.name = "ApiClientError";
    this.status = opts.status;
    this.code = opts.code;
    this.fields = opts.fields;
    if (opts.trace && process.env.NODE_ENV !== "production") {
      console.error(`[api ${opts.code}]`, opts.trace);
    }
  }
}

/** Max attempts (1 initial + retries) for transient failures. */
const MAX_ATTEMPTS = 3;
/** Base backoff in ms; grows exponentially per attempt. */
const RETRY_BASE_MS = 300;

/**
 * Only transient failures are worth retrying. 4xx responses (e.g. 404, 401,
 * 422) are deterministic — retrying them just produces a tight loop — so we
 * retry network errors and 5xx/429 server responses only.
 */
function isRetryable(err: unknown): boolean {
  if (err instanceof ApiClientError) {
    return err.status >= 500 || err.status === 429 || err.status === 0;
  }
  // Thrown by fetch itself (offline, DNS, abort): retry.
  return true;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function requestOnce<T>(input: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(input, {
      ...init,
      headers: {
        ...(init?.body && !(init.body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
        ...init?.headers,
      },
    });
  } catch {
    // Network-level failure (no response). Surface as a retryable error.
    throw new ApiClientError({
      message: "Network request failed",
      status: 0,
      code: "NETWORK_ERROR",
    });
  }

  let json: ApiResponse<T>;
  try {
    json = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new ApiClientError({
      message: `Request failed (${res.status})`,
      status: res.status,
      code: "NETWORK_ERROR",
    });
  }

  if (!json.ok) {
    throw new ApiClientError(json.error);
  }
  return json.data;
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await requestOnce<T>(input, init);
    } catch (err) {
      lastErr = err;
      // Stop immediately on deterministic (non-retryable) errors like 404.
      if (!isRetryable(err) || attempt === MAX_ATTEMPTS) break;
      await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
    }
  }
  throw lastErr;
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body?: unknown) =>
    request<T>(url, {
      method: "POST",
      body:
        body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    }),
  put: <T>(url: string, body?: unknown) =>
    request<T>(url, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(url: string, body?: unknown) =>
    request<T>(url, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  del: <T>(url: string) => request<T>(url, { method: "DELETE" }),
  pinArticle: <T>(articleId: string) => request<T>(`/api/articles/${articleId}/pin`, { method: "POST" }),
  unpinArticle: <T>(articleId: string) => request<T>(`/api/articles/${articleId}/pin`, { method: "DELETE" }),
};
