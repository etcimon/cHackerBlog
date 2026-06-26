/**
 * Theme selection helpers.
 *
 * Styling lives entirely in SCSS (src/styles/themes/*). Each theme is emitted as
 * a `[data-theme="…"]` block of CSS custom properties, and the active theme is
 * chosen by the THEME env var. The layout sets <html data-theme={activeTheme()}>
 * — there is no per-site styling stored in the database anymore.
 */
import { env } from "@/lib/env";

export const THEMES = ["hacker", "medium", "substack"] as const;
export type ThemeName = (typeof THEMES)[number];

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/** The theme configured via the THEME env var (defaults to "hacker"). */
export function activeTheme(): ThemeName {
  return env.THEME;
}
