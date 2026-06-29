/**
 * Root layout (server component). Loads SiteSettings for branding/metadata,
 * selects the active SCSS theme via <html data-theme> (from the THEME env var),
 * applies admin-defined custom <head> HTML, and mounts the client provider tree
 * (toasts + admin session) plus the themable footer. Styling itself lives in
 * src/styles (SCSS), not in the database.
 */
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Script from "next/script";
import "@/styles/globals.scss";
import { getSettings } from "@/lib/settings";
import { activeTheme, resolvedCodeTheme } from "@/lib/theme";
import { Providers } from "@/components/providers";
import { Footer } from "@/components/footer";

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSettings();
  return {
    title: s.title || "cHackerBlog",
    description: s.description || "Cimon's Hacker Blog",
    icons: s.faviconUrl ? [{ url: s.faviconUrl }] : undefined,
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const settings = await getSettings();

  return (
    <html lang="en" data-theme={activeTheme()} data-code-theme={resolvedCodeTheme()}>
      <head>
        {/* Favicon / App Icons */}
        <link rel="icon" href="/favicon/logo.ico" sizes="any" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon/favicon-16x16.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/favicon/apple-touch-icon.png" />
        <meta name="theme-color" content="#0b2dff" />
        <link rel="manifest" href="/favicon/site.webmanifest" />
        <meta name="msapplication-TileColor" content="#0b2dff" />
        <meta name="msapplication-config" content="/favicon/browserconfig.xml" />
        {/* Admin-provided custom <head> HTML (analytics, meta, fonts, etc.). */}
        {settings.headHtml ? (
          <div dangerouslySetInnerHTML={{ __html: settings.headHtml }} />
        ) : null}
      </head>
      <body className="crt-scan min-h-screen">
        <Providers>
          {children}
          <Footer xHandle={settings.xHandle} linkedinUrl={settings.linkedinUrl} />
        </Providers>
      </body>
    </html>
  );
}
