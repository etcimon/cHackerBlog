/**
 * Unit tests for the api-client retry policy: transient failures (5xx) are
 * retried only for GET requests; mutations get exactly one attempt so a
 * failed create/comment/upload/translate is never re-sent.
 */
import { api, ApiClientError } from "@/lib/api-client";

describe("api client retry policy", () => {
  const realFetch = globalThis.fetch;
  let fetchCalls = 0;

  beforeEach(() => {
    fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls++;
      return new Response(
        JSON.stringify({
          ok: false,
          error: { code: "X", status: 502, message: "m" },
        }),
        { status: 502, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("does not retry a failed POST", async () => {
    await expect(api.post("/x", {})).rejects.toBeInstanceOf(ApiClientError);
    expect(fetchCalls).toBe(1);
  });

  it("retries a failed GET up to 3 attempts", async () => {
    await expect(api.get("/x")).rejects.toBeInstanceOf(ApiClientError);
    expect(fetchCalls).toBe(3);
  }, 10_000);
});
