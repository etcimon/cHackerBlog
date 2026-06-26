/**
 * Social auto-posting orchestrator. Called after an article is published; posts
 * to every configured network in parallel. Best-effort: failures are logged but
 * never block publishing. Gated by SOCIAL_AUTOPOST_ENABLED and the per-article
 * / per-settings `socialAutopost` flag.
 */
import { env } from "@/lib/env";
import { postToX, xConfigured } from "@/lib/social/x";
import { postToLinkedIn, linkedinConfigured } from "@/lib/social/linkedin";

export interface AutopostInput {
  title: string;
  preview: string;
  slug: string;
}

export interface AutopostResult {
  x: string | null;
  linkedin: string | null;
}

export async function autopostArticle(
  input: AutopostInput,
  settingsAllow: boolean,
): Promise<AutopostResult> {
  const enabled = env.SOCIAL_AUTOPOST_ENABLED && settingsAllow;
  if (!enabled) return { x: null, linkedin: null };

  const url = `${env.APP_URL}/#${input.slug}`;
  const text = `${input.title}\n\n${input.preview}`.slice(0, 270);

  const [x, linkedin] = await Promise.all([
    xConfigured() ? postToX(`${text}\n${url}`) : Promise.resolve(null),
    linkedinConfigured() ? postToLinkedIn(text, url) : Promise.resolve(null),
  ]);

  return { x, linkedin };
}
