"use client";

/**
 * Client i18n hook. Resolves the active site-chrome locale from the site
 * settings policy (defaultLocale + translationMode) and, in "user-specific"
 * mode, the browser's language preferences. Returns the resolved locale, its
 * message catalog, a `t(path)` lookup, and text direction. Also reflects the
 * resolved locale onto <html lang/dir> so the whole document stays consistent.
 */
import { useEffect, useMemo } from "react";
import { usePathname } from "next/navigation";
import {
  DEFAULT_LOCALE,
  getMessages,
  isSupportedLocale,
  localeDir,
  resolveLocale,
  type Locale,
  type Messages,
} from "@/lib/i18n";
import { useSiteConfig } from "@/lib/use-site-config";

/**
 * Extract a supported locale from the first path segment (e.g. "/fr/article/x"
 * -> "fr"). Returns null when there is no locale prefix. This is what powers the
 * /[lang]/... URL language selector.
 */
export function localeFromPathname(pathname: string | null): Locale | null {
  const first = (pathname ?? "").split("/").filter(Boolean)[0];
  return isSupportedLocale(first) ? first : null;
}

/** Resolve a dotted path (e.g. "translation.show") against the catalog. */
function lookup(messages: Messages, path: string): string {
  const value = path
    .split(".")
    .reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), messages);
  return typeof value === "string" ? value : path;
}

export interface I18n {
  locale: Locale;
  messages: Messages;
  dir: "ltr" | "rtl";
  t: (path: string) => string;
}

export function useI18n(): I18n {
  const config = useSiteConfig();
  const pathname = usePathname();

  const locale = useMemo<Locale>(() => {
    // i18n kill-switch: force English and ignore URL/browser/settings entirely.
    if (config?.i18nDisabled) return DEFAULT_LOCALE;

    // An explicit /[lang]/ URL prefix always wins, regardless of policy — the
    // visitor navigated to that language on purpose.
    const pathLocale = localeFromPathname(pathname);
    if (pathLocale) return pathLocale;

    if (!config) return DEFAULT_LOCALE;
    const acceptLanguage =
      typeof navigator !== "undefined" ? navigator.languages?.join(",") ?? navigator.language : null;
    return resolveLocale({
      defaultLocale: config.defaultLocale,
      translationMode: config.translationMode,
      acceptLanguage,
    });
  }, [config, pathname]);

  const messages = useMemo(() => getMessages(locale), [locale]);
  const dir = localeDir(locale);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
      document.documentElement.dir = dir;
    }
  }, [locale, dir]);

  return {
    locale,
    messages,
    dir,
    t: (path: string) => lookup(messages, path),
  };
}
