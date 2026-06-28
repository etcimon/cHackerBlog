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

/** Site themes that use a dark background (so code blocks pick dark hljs CSS). */
const DARK_THEMES: readonly ThemeName[] = ["hacker"];

/** Whether the given (or active) site theme uses a dark background. */
export function isDarkTheme(theme: ThemeName = activeTheme()): boolean {
  return DARK_THEMES.includes(theme);
}

/**
 * Resolve the highlight.js stylesheet name to load, honouring CODE_THEME.
 * The default "github" auto-switches to "github-dark" on dark site themes,
 * giving a sensible light/dark pairing out of the box. Any other CODE_THEME
 * value is used verbatim (e.g. "monokai", "nord", "atom-one-dark").
 */
export function resolvedCodeTheme(): string {
  const code = env.CODE_THEME;
  if (code === "github" && isDarkTheme()) return "github-dark";
  return code;
}
