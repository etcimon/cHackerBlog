"use client";

/**
 * Footer language selector. Rewrites the current path's leading locale segment
 * to the chosen language using the /[lang]/... URL scheme (the site default
 * locale yields a clean, unprefixed URL). The selected value is derived from
 * the active locale resolved by useI18n (URL prefix > browser > settings), so
 * the control always reflects what the visitor is actually seeing.
 */
import { Globe } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { SUPPORTED_LOCALES, buildLocalePath } from "@/lib/i18n";
import { useI18n } from "@/lib/use-i18n";
import { useSiteConfig } from "@/lib/use-site-config";

export function LanguageSwitcher() {
  const pathname = usePathname();
  const router = useRouter();
  const { locale } = useI18n();
  const config = useSiteConfig();
  const defaultLocale = config?.defaultLocale ?? "en";

  // Hidden entirely when i18n is disabled (DISABLE_I18N) — the site is English-only.
  if (config?.i18nDisabled) return null;

  const onChange = (target: string) => {
    if (target === locale) return;
    router.push(buildLocalePath(pathname || "/", target, defaultLocale));
  };

  return (
    <label className="inline-flex items-center gap-1.5 text-muted">
      <Globe className="h-4 w-4" aria-hidden />
      <span className="sr-only">Language</span>
      <select
        value={locale}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-border bg-card px-2 py-1 text-sm text-muted outline-none transition-colors hover:text-fg focus:border-accent"
      >
        {SUPPORTED_LOCALES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.nativeName}
          </option>
        ))}
      </select>
    </label>
  );
}
