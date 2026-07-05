/**
 * Locale-prefixed home route: /[lang]  (e.g. /fr, /ja).
 *
 * The prefix only selects the UI language — the actual feed rendering is
 * identical to the canonical "/" route, so we validate the segment is a
 * supported locale (404 otherwise) and delegate to the shared HomePage server
 * component. The active locale is picked up client-side from the URL by
 * `useI18n` (see lib/use-i18n.ts).
 */
import { notFound } from "next/navigation";
import { isSupportedLocale } from "@/lib/i18n";
import { env } from "@/lib/env";
import HomePage from "@/app/page";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ lang: string }> };

export default async function LocalizedHomePage({ params }: Params) {
  const { lang } = await params;
  // The /[lang]/ URL scheme is disabled when i18n is off (English-only site).
  if (env.DISABLE_I18N || !isSupportedLocale(lang)) notFound();
  return HomePage();
}
