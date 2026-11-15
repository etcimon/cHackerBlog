"use client";

import { useSiteConfig } from "@/lib/use-site-config";

/**
 * Whether reader comments are enabled site-wide. Reads the public site config
 * (GET /api/settings, which exposes COMMENTS_ENABLED); defaults to true until
 * the config loads.
 */
export function useCommentsEnabled(): boolean {
  return useSiteConfig()?.commentsEnabled ?? true;
}
