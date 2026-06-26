/**
 * Settings service: reads/writes the SiteSettings singleton, memoized in Redis
 * under the "settings" cache category. The setup screen and every page header
 * depend on this.
 */
import { prisma } from "@/lib/prisma";
import { remember, invalidate } from "@/lib/cache";
import type { SiteSettingsInput } from "@/lib/schemas";

const SETTINGS_ID = 1;
const CACHE_KEY = "singleton";

export type SiteSettings = Awaited<ReturnType<typeof loadFromDb>>;

async function loadFromDb() {
  return prisma.siteSettings.upsert({
    where: { id: SETTINGS_ID },
    update: {},
    create: { id: SETTINGS_ID },
  });
}

export async function getSettings(): Promise<SiteSettings> {
  return remember("settings", CACHE_KEY, loadFromDb);
}

export async function isSetupComplete(): Promise<boolean> {
  const s = await getSettings();
  return s.setupComplete;
}

export async function updateSettings(
  input: Partial<SiteSettingsInput> & { setupComplete?: boolean },
): Promise<SiteSettings> {
  const updated = await prisma.siteSettings.update({
    where: { id: SETTINGS_ID },
    data: {
      ...input,
      // Normalize empty strings to null for optional URL fields.
      faviconUrl: input.faviconUrl || null,
      coverUrl: input.coverUrl || null,
      authorThumbUrl: (input as { authorThumbUrl?: string }).authorThumbUrl || null,
      linkedinUrl: input.linkedinUrl || null,
      xHandle: input.xHandle || null,
    },
  });
  await invalidate("settings", CACHE_KEY);
  return updated;
}
