/**
 * Unit tests for the i18n resolver + catalog loader.
 *
 * These validate that the active site-chrome locale is derived correctly from
 * the SiteSettings policy (defaultLocale + translationMode) and, in
 * "user-specific" mode, the visitor's Accept-Language / cookie preference — and
 * that every supported locale loads a complete, structurally-identical catalog.
 */
import {
  SUPPORTED_LOCALE_CODES,
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  buildLocalePath,
  getMessages,
  isSupportedLocale,
  localeLabel,
  localeDir,
  parseAcceptLanguage,
  resolveLocale,
} from "@/lib/i18n";
import en from "@/locales/en.json";

describe("supported locale registry", () => {
  it("exposes exactly ten locales with English as the default", () => {
    expect(SUPPORTED_LOCALE_CODES).toHaveLength(10);
    expect(SUPPORTED_LOCALE_CODES).toContain("en");
    expect(DEFAULT_LOCALE).toBe("en");
  });

  it("keeps codes and the descriptor list in sync", () => {
    expect(SUPPORTED_LOCALES.map((l) => l.code)).toEqual([...SUPPORTED_LOCALE_CODES]);
  });

  it("narrows codes with isSupportedLocale", () => {
    expect(isSupportedLocale("fr")).toBe(true);
    expect(isSupportedLocale("xx")).toBe(false);
    expect(isSupportedLocale(null)).toBe(false);
    expect(isSupportedLocale(42)).toBe(false);
  });

  it("marks Arabic as RTL and others as LTR", () => {
    expect(localeDir("ar")).toBe("rtl");
    expect(localeDir("en")).toBe("ltr");
    expect(localeDir("ja")).toBe("ltr");
  });

  it("returns English labels for codes", () => {
    expect(localeLabel("fr")).toBe("French");
    expect(localeLabel("en")).toBe("English");
    expect(localeLabel("unknown")).toBe("unknown");
  });
});

describe("catalog loader (getMessages)", () => {
  it("loads the correct catalog for each supported locale", () => {
    expect(getMessages("en").common.fullText).toBe("Full text");
    expect(getMessages("fr").common.fullText).toBe("Texte intégral");
    expect(getMessages("es").translation.show).toBe("Mostrar traducción");
    expect(getMessages("ja").common.home).toBe("ホーム");
  });

  it("falls back to English for an unsupported locale", () => {
    expect(getMessages("xx")).toBe(getMessages("en"));
  });

  it("every locale has the same key structure as English", () => {
    const keysOf = (obj: unknown, prefix = ""): string[] =>
      obj && typeof obj === "object"
        ? Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
            v && typeof v === "object" ? keysOf(v, `${prefix}${k}.`) : [`${prefix}${k}`],
          )
        : [];

    const enKeys = keysOf(en).sort();
    for (const code of SUPPORTED_LOCALE_CODES) {
      expect(keysOf(getMessages(code)).sort()).toEqual(enKeys);
    }
  });
});

describe("parseAcceptLanguage", () => {
  it("returns an empty list for missing headers", () => {
    expect(parseAcceptLanguage(null)).toEqual([]);
    expect(parseAcceptLanguage("")).toEqual([]);
  });

  it("orders base codes by descending q-value", () => {
    expect(parseAcceptLanguage("fr-CA,fr;q=0.9,en;q=0.8")).toEqual(["fr", "fr", "en"]);
    expect(parseAcceptLanguage("de;q=0.7,ja;q=0.9")).toEqual(["ja", "de"]);
  });
});

describe("buildLocalePath (/[lang]/... URL scheme)", () => {
  it("prefixes non-default locales", () => {
    expect(buildLocalePath("/", "fr", "en")).toBe("/fr");
    expect(buildLocalePath("/article/my-post", "fr", "en")).toBe("/fr/article/my-post");
  });

  it("produces clean, unprefixed URLs for the site default locale", () => {
    expect(buildLocalePath("/fr/article/my-post", "en", "en")).toBe("/article/my-post");
    expect(buildLocalePath("/fr", "en", "en")).toBe("/");
  });

  it("replaces an existing locale prefix rather than stacking it", () => {
    expect(buildLocalePath("/fr/article/x", "ja", "en")).toBe("/ja/article/x");
    expect(buildLocalePath("/ja", "fr", "en")).toBe("/fr");
  });

  it("respects a non-English site default", () => {
    // Default is French: French is clean, English is prefixed.
    expect(buildLocalePath("/article/x", "fr", "fr")).toBe("/article/x");
    expect(buildLocalePath("/article/x", "en", "fr")).toBe("/en/article/x");
    expect(buildLocalePath("/en/article/x", "fr", "fr")).toBe("/article/x");
  });

  it("normalizes an unsupported site default to English semantics", () => {
    expect(buildLocalePath("/", "en", "xx")).toBe("/");
    expect(buildLocalePath("/", "fr", "xx")).toBe("/fr");
  });
});

describe("resolveLocale (settings-driven)", () => {
  it("default mode always returns the configured default locale", () => {
    expect(
      resolveLocale({
        defaultLocale: "fr",
        translationMode: "default",
        acceptLanguage: "ja,de;q=0.8",
      }),
    ).toBe("fr");
  });

  it("default mode normalizes an unsupported default to English", () => {
    expect(
      resolveLocale({ defaultLocale: "xx", translationMode: "default" }),
    ).toBe("en");
  });

  it("user-specific mode negotiates from Accept-Language", () => {
    expect(
      resolveLocale({
        defaultLocale: "en",
        translationMode: "user-specific",
        acceptLanguage: "ja-JP,ja;q=0.9,en;q=0.5",
      }),
    ).toBe("ja");
  });

  it("user-specific mode prefers a supported cookie override", () => {
    expect(
      resolveLocale({
        defaultLocale: "en",
        translationMode: "user-specific",
        acceptLanguage: "de",
        cookieLocale: "es",
      }),
    ).toBe("es");
  });

  it("user-specific mode falls back to the default when nothing matches", () => {
    expect(
      resolveLocale({
        defaultLocale: "pt",
        translationMode: "user-specific",
        acceptLanguage: "xx,zz",
      }),
    ).toBe("pt");
  });

  it("disabled (DISABLE_I18N) forces English over every other signal", () => {
    expect(
      resolveLocale({
        defaultLocale: "fr",
        translationMode: "user-specific",
        acceptLanguage: "ja,de;q=0.8",
        cookieLocale: "es",
        disabled: true,
      }),
    ).toBe("en");
    // Even with a non-English default in "default" mode.
    expect(
      resolveLocale({ defaultLocale: "ja", translationMode: "default", disabled: true }),
    ).toBe("en");
  });
});
