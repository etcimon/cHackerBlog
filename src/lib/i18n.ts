/**
 * Internationalization core.
 *
 * Two localization surfaces exist in cHackerBlog:
 *   1. Site chrome (this module): a fixed vocabulary of UI strings resolved from
 *      committed JSON catalogs under src/locales/*.json.
 *   2. Article bodies (lib/grok.ts): open-ended content machine-translated on
 *      demand via the Grok API.
 *
 * The active site-chrome locale is *derived* from the SiteSettings policy
 * (defaultLocale + translationMode) and, in "user-specific" mode, the request's
 * language preference. Every supported code maps to a real catalog at build
 * time, so a "missing catalog" state is unrepresentable and the resolver is a
 * total function that always returns a supported locale.
 */
import en from "@/locales/en.json";
import es from "@/locales/es.json";
import zh from "@/locales/zh.json";
import hi from "@/locales/hi.json";
import ar from "@/locales/ar.json";
import pt from "@/locales/pt.json";
import fr from "@/locales/fr.json";
import ru from "@/locales/ru.json";
import de from "@/locales/de.json";
import ja from "@/locales/ja.json";

/** Message catalog shape (mirrors src/locales/en.json). */
export type Messages = typeof en;

/** Translation policy stored on the SiteSettings singleton. */
export type TranslationMode = "default" | "user-specific";

/**
 * The ten supported locales (by global speaker population). English is the
 * canonical source and the ultimate fallback. `dir` drives <html dir> for RTL
 * scripts (Arabic).
 */
export const SUPPORTED_LOCALES = [
  { code: "en", label: "English", nativeName: "English", dir: "ltr" },
  { code: "es", label: "Spanish", nativeName: "Español", dir: "ltr" },
  { code: "zh", label: "Chinese", nativeName: "中文", dir: "ltr" },
  { code: "hi", label: "Hindi", nativeName: "हिन्दी", dir: "ltr" },
  { code: "ar", label: "Arabic", nativeName: "العربية", dir: "rtl" },
  { code: "pt", label: "Portuguese", nativeName: "Português", dir: "ltr" },
  { code: "fr", label: "French", nativeName: "Français", dir: "ltr" },
  { code: "ru", label: "Russian", nativeName: "Русский", dir: "ltr" },
  { code: "de", label: "German", nativeName: "Deutsch", dir: "ltr" },
  { code: "ja", label: "Japanese", nativeName: "日本語", dir: "ltr" },
] as const;

/** Tuple of supported locale codes (for zod enums and iteration). */
export const SUPPORTED_LOCALE_CODES = [
  "en", "es", "zh", "hi", "ar", "pt", "fr", "ru", "de", "ja",
] as const;

export type Locale = (typeof SUPPORTED_LOCALE_CODES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** Static code -> catalog map. Total over SUPPORTED_LOCALE_CODES. */
const CATALOGS: Record<Locale, Messages> = { en, es, zh, hi, ar, pt, fr, ru, de, ja };

/** Human-readable language name for a code (used in translation prompts/UI). */
const LANG_NAMES: Record<Locale, string> = SUPPORTED_LOCALES.reduce(
  (acc, l) => ({ ...acc, [l.code]: l.label }),
  {} as Record<Locale, string>,
);

/** Narrowing guard: is `value` one of the supported locale codes? */
export function isSupportedLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" &&
    (SUPPORTED_LOCALE_CODES as readonly string[]).includes(value)
  );
}

/** English label for a locale code (e.g. "fr" -> "French"). */
export function localeLabel(code: string): string {
  return isSupportedLocale(code) ? LANG_NAMES[code] : code;
}

/** Text direction for a locale ("rtl" only for Arabic here). */
export function localeDir(code: string): "ltr" | "rtl" {
  const entry = SUPPORTED_LOCALES.find((l) => l.code === code);
  return entry?.dir === "rtl" ? "rtl" : "ltr";
}

/**
 * Return the message catalog for a locale. Falls back to English for any
 * unsupported code, so callers never crash on bad input.
 */
export function getMessages(locale: string): Messages {
  return isSupportedLocale(locale) ? CATALOGS[locale] : CATALOGS[DEFAULT_LOCALE];
}

/**
 * Parse an HTTP `Accept-Language` header into an ordered list of base language
 * codes (highest q-value first). "fr-CA,fr;q=0.9,en;q=0.8" -> ["fr","fr","en"].
 */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith("q="));
      const quality = q ? parseFloat(q.slice(2)) : 1;
      return { code: tag.split("-")[0]?.toLowerCase() ?? "", quality };
    })
    .filter((x) => x.code)
    .sort((a, b) => b.quality - a.quality)
    .map((x) => x.code);
}

/**
 * Rewrite a path's leading locale segment for the /[lang]/... URL scheme.
 *
 *  - Any existing supported-locale prefix is stripped first.
 *  - The site default locale produces a clean, unprefixed URL ("/", "/article/x").
 *  - Every other locale is prefixed ("/fr", "/fr/article/x").
 *
 * Query strings / hashes are not part of `pathname` and are handled by callers.
 */
export function buildLocalePath(
  pathname: string,
  targetLocale: string,
  defaultLocale: string,
): string {
  const segments = (pathname || "/").split("/").filter(Boolean);
  if (isSupportedLocale(segments[0])) segments.shift();

  const normalizedDefault: Locale = isSupportedLocale(defaultLocale)
    ? defaultLocale
    : DEFAULT_LOCALE;

  const rest = targetLocale === normalizedDefault ? segments : [targetLocale, ...segments];
  return "/" + rest.join("/");
}

export interface ResolveLocaleInput {
  /** SiteSettings.defaultLocale (may be any string; normalized here). */
  defaultLocale: string;
  /** SiteSettings.translationMode. */
  translationMode: TranslationMode;
  /** Request Accept-Language header (only consulted in user-specific mode). */
  acceptLanguage?: string | null;
  /** Explicit per-user override (cookie/query), highest priority when supported. */
  cookieLocale?: string | null;
  /** i18n kill-switch (DISABLE_I18N): force English regardless of any signal. */
  disabled?: boolean;
}

/**
 * Derive the active site-chrome locale from the settings policy.
 *
 *  - "default" mode: always the configured default (normalized to a supported
 *    code, ultimately "en").
 *  - "user-specific" mode: an explicit cookie override if supported, else the
 *    best Accept-Language match, else the configured default.
 *
 * Always returns a supported Locale.
 */
export function resolveLocale(input: ResolveLocaleInput): Locale {
  // Kill-switch wins over every other signal.
  if (input.disabled) return DEFAULT_LOCALE;

  const fallback: Locale = isSupportedLocale(input.defaultLocale)
    ? input.defaultLocale
    : DEFAULT_LOCALE;

  if (input.translationMode !== "user-specific") return fallback;

  if (isSupportedLocale(input.cookieLocale)) return input.cookieLocale;

  for (const code of parseAcceptLanguage(input.acceptLanguage)) {
    if (isSupportedLocale(code)) return code;
  }

  return fallback;
}
