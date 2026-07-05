/**
 * Locale-prefixed article route: /[lang]/article/[slug]  (e.g.
 * /fr/article/my-post). The `[lang]` prefix selects the UI language; the
 * article itself is located and rendered exactly like the canonical
 * /article/[slug] route, so we validate the locale segment (404 otherwise) and
 * delegate to the shared server component + metadata generator. The active
 * locale is applied client-side from the URL by `useI18n`.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isSupportedLocale } from "@/lib/i18n";
import { env } from "@/lib/env";
import ArticlePage, { generateMetadata as baseGenerateMetadata } from "@/app/article/[slug]/page";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ lang: string; slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { lang, slug } = await params;
  if (env.DISABLE_I18N || !isSupportedLocale(lang)) return { title: "Not found" };
  // Reuse the canonical article metadata (canonical URL intentionally points at
  // the unprefixed /article/<slug> to avoid duplicate-content across locales).
  return baseGenerateMetadata({ params: Promise.resolve({ slug }) });
}

export default async function LocalizedArticlePage({ params }: Params) {
  const { lang, slug } = await params;
  // The /[lang]/ URL scheme is disabled when i18n is off (English-only site).
  if (env.DISABLE_I18N || !isSupportedLocale(lang)) notFound();
  return ArticlePage({ params: Promise.resolve({ slug }) });
}
