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

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...init?.headers,
    },
  });

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
