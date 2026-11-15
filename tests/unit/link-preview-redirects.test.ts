/**
 * Unit tests for the link-preview SSRF redirect guard: redirects are followed
 * manually so every hop is re-validated, private targets are blocked, and the
 * hop count is capped. fetch is mocked; literal public IPs avoid DNS lookups.
 */
import { fetchWithSafeRedirects, isPrivateAddress } from "@/lib/link-preview";
import { AppError } from "@/lib/errors";

const START = new URL("http://93.184.216.34/");

function redirect(location: string): Response {
  return {
    status: 302,
    headers: new Headers({ location }),
    body: null,
  } as unknown as Response;
}

function htmlPage(): Response {
  return new Response("<html><head><title>T</title></head></html>", {
    status: 200,
    headers: { "content-type": "text/html" },
  });
}

describe("link-preview safe redirects", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("blocks a redirect to a private address after a single fetch", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return redirect("http://127.0.0.1/admin");
    }) as typeof fetch;

    const err = await fetchWithSafeRedirects(START).then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("SSRF_BLOCKED");
    expect(calls).toBe(1);
  });

  it("follows safe redirects and reports the final URL", async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      seen.push(url);
      if (url === "http://93.184.216.34/") {
        return redirect("http://93.184.216.35/next");
      }
      return htmlPage();
    }) as typeof fetch;

    const out = await fetchWithSafeRedirects(START);
    expect(out.url.href).toBe("http://93.184.216.35/next");
    expect(seen).toEqual(["http://93.184.216.34/", "http://93.184.216.35/next"]);
  });

  it("rejects with TOO_MANY_REDIRECTS after the redirect cap", async () => {
    globalThis.fetch = (async () =>
      redirect("http://93.184.216.35/next")) as typeof fetch;

    const err = await fetchWithSafeRedirects(START).then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("TOO_MANY_REDIRECTS");
  });

  it("isPrivateAddress covers CGNAT, benchmarking and multicast ranges", () => {
    expect(isPrivateAddress("100.64.0.1")).toBe(true);
    expect(isPrivateAddress("198.18.0.1")).toBe(true);
    expect(isPrivateAddress("224.0.0.1")).toBe(true);
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
  });
});
