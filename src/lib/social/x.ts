/**
 * X (Twitter) auto-posting via API v2 POST /2/tweets, authenticated with
 * OAuth 1.0a user context (HMAC-SHA1). Implemented with node:crypto so no extra
 * dependency is required. Returns the new tweet id or null on failure.
 */
import { createHmac, randomBytes } from "node:crypto";
import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";

const log = createLogger("social:x");

export function xConfigured(): boolean {
  return Boolean(
    env.X_API_KEY && env.X_API_SECRET && env.X_ACCESS_TOKEN && env.X_ACCESS_SECRET,
  );
}

function rfc3986(str: string): string {
  return encodeURIComponent(str).replace(
    /[!*'()]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/** Build the OAuth 1.0a Authorization header for a POST request. */
function buildOAuthHeader(method: string, url: string): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: env.X_API_KEY!,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: env.X_ACCESS_TOKEN!,
    oauth_version: "1.0",
  };

  // Signature base string (body is JSON, so it is not part of the signature).
  const paramString = Object.keys(oauth)
    .sort()
    .map((k) => `${rfc3986(k)}=${rfc3986(oauth[k]!)}`)
    .join("&");
  const baseString = [
    method.toUpperCase(),
    rfc3986(url),
    rfc3986(paramString),
  ].join("&");

  const signingKey = `${rfc3986(env.X_API_SECRET!)}&${rfc3986(env.X_ACCESS_SECRET!)}`;
  const signature = createHmac("sha1", signingKey)
    .update(baseString)
    .digest("base64");

  const headerParams = { ...oauth, oauth_signature: signature };
  return (
    "OAuth " +
    Object.keys(headerParams)
      .sort()
      .map((k) => `${rfc3986(k)}="${rfc3986(headerParams[k as keyof typeof headerParams]!)}"`)
      .join(", ")
  );
}

export async function postToX(text: string): Promise<string | null> {
  if (!xConfigured()) return null;
  const url = "https://api.twitter.com/2/tweets";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: buildOAuthHeader("POST", url),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      log.error("failed:", res.status, await res.text());
      return null;
    }
    const json = (await res.json()) as { data?: { id?: string } };
    return json.data?.id ?? null;
  } catch (err) {
    log.error("error:", (err as Error).message);
    return null;
  }
}
