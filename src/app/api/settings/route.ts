/**
 * Settings endpoint.
 *   GET -> public-safe settings + setup status (drives header/footer/theme).
 *   PUT -> admin updates settings; first successful save marks setup complete.
 */
import { handler, ok } from "@/lib/errors";
import { siteSettingsSchema } from "@/lib/schemas";
import { getSettings, updateSettings } from "@/lib/settings";
import { requireAdmin } from "@/lib/auth";
import { grokConfigured, env } from "@/lib/env";

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
    defaultLocale: s.defaultLocale,
    translationMode: s.translationMode,
    // Whether the Grok translation integration is usable (drives the
    // "show translation" affordance on article cards).
    grokConfigured: grokConfigured(),
    // i18n kill-switch: when true the site is forced to English and the
    // language switcher is hidden (see DISABLE_I18N).
    i18nDisabled: env.DISABLE_I18N,
  });
});

export const PUT = handler(async (req: Request) => {
  requireAdmin();
  const body = await req.json().catch(() => ({}));
  const input = siteSettingsSchema.parse(body);
  const updated = await updateSettings({ ...input, setupComplete: true });
  return ok({ setupComplete: updated.setupComplete });
});
