/**
 * LinkedIn auto-posting via the UGC Posts API. Requires a member/organization
 * access token (LINKEDIN_ACCESS_TOKEN) and the author URN (LINKEDIN_AUTHOR_URN,
 * e.g. "urn:li:person:xxxx"). Returns the created post id or null on failure.
 */
import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";

const log = createLogger("social:linkedin");

export function linkedinConfigured(): boolean {
  return Boolean(env.LINKEDIN_ACCESS_TOKEN && env.LINKEDIN_AUTHOR_URN);
}

export async function postToLinkedIn(text: string, url: string): Promise<string | null> {
  if (!linkedinConfigured()) return null;
  try {
    const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.LINKEDIN_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify({
        author: env.LINKEDIN_AUTHOR_URN,
        lifecycleState: "PUBLISHED",
        specificContent: {
          "com.linkedin.ugc.ShareContent": {
            shareCommentary: { text: `${text}\n\n${url}` },
            shareMediaCategory: "ARTICLE",
            media: [
              {
                status: "READY",
                originalUrl: url,
              },
            ],
          },
        },
        visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      log.error("failed:", res.status, await res.text());
      return null;
    }
    return res.headers.get("x-restli-id") ?? "ok";
  } catch (err) {
    log.error("error:", (err as Error).message);
    return null;
  }
}
