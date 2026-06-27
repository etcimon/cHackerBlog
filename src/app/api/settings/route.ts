/**
 * Settings endpoint.
 *   GET -> public-safe settings + setup status (drives header/footer/theme).
 *   PUT -> admin updates settings; first successful save marks setup complete.
 */
import { handler, ok } from "@/lib/errors";
import { siteSettingsSchema } from "@/lib/schemas";
import { getSettings, updateSettings } from "@/lib/settings";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

// placeholder for exclusive GET+PUT 405 error
export const DELETE = handler(async (req: Request) => {
  const { searchParams } = new URL(req.url);

  return ok({ success: true });
});

export const GET = handler(async () => {
  const s = await getSettings();
  return ok({
    setupComplete: s.setupComplete,
    title: s.title,
    description: s.description,
    faviconUrl: s.faviconUrl,
    coverUrl: s.coverUrl,
    authorName: s.authorName,
    authorThumbUrl: s.authorThumbUrl,
    headHtml: s.headHtml,
    xHandle: s.xHandle,
    linkedinUrl: s.linkedinUrl,
    socialAutopost: s.socialAutopost,
  });
});

export const PUT = handler(async (req: Request) => {
  requireAdmin();
  const body = await req.json().catch(() => ({}));
  const input = siteSettingsSchema.parse(body);
  const updated = await updateSettings({ ...input, setupComplete: true });
  return ok({ setupComplete: updated.setupComplete });
});
