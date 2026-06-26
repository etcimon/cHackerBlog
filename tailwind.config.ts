import type { Config } from "tailwindcss";

/**
 * Theme colors/fonts are driven by CSS variables injected at runtime from the
 * database SiteSettings and/or .env defaults (see src/lib/theme.ts). This lets
 * the "green hacker terminal on black" theme be toggled without a rebuild.
 */
const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--cb-bg) / <alpha-value>)",
        fg: "rgb(var(--cb-fg) / <alpha-value>)",
        accent: "rgb(var(--cb-accent) / <alpha-value>)",
        muted: "rgb(var(--cb-muted) / <alpha-value>)",
        card: "rgb(var(--cb-card) / <alpha-value>)",
        border: "rgb(var(--cb-border) / <alpha-value>)",
      },
      fontFamily: {
        body: "var(--cb-font-body)",
        heading: "var(--cb-font-heading)",
        mono: "var(--cb-font-mono)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "expand": {
          from: { opacity: "0", maxHeight: "0" },
          to: { opacity: "1", maxHeight: "5000px" },
        },
        "scan": {
          from: { backgroundPosition: "0 0" },
          to: { backgroundPosition: "0 100%" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.5s ease-out both",
        "expand": "expand 0.45s ease-out both",
        "scan": "scan 8s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
