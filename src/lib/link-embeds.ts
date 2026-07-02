/**
 * Client-side hydration for URL embeds.
 *
 * Two responsibilities, both idempotent and safe to call after every (re)render
 * of a surface that may contain embeds (WYSIWYG rich body, Markdown preview, and
 * the rendered article body):
 *
 *  1. Generic link-preview cards (`[data-link-hydrate="1"]`) are enriched by
 *     fetching Open Graph metadata from `/api/link-preview` and filling in the
 *     real title / description / thumbnail. The base HTML already shows the host
 *     + a Visit-site button, so hydration is purely additive and network
 *     failures leave a usable card.
 *
 *  2. Script-driven providers (currently X via `widgets.js`) declare their
 *     external script through `data-embed-script`. Each unique script is
 *     injected at most once; after load, the provider's widget factory is asked
 *     to upgrade any blockquotes in the root.
 */
import { api } from "@/lib/api-client";
import type { LinkPreview } from "@/lib/link-preview";

/** Scripts already injected (module-scoped so it survives re-renders). */
const loadedScripts = new Set<string>();

interface TwitterWidgets {
  widgets?: { load?: (el?: HTMLElement) => void };
}

function loadScriptOnce(src: string): Promise<void> {
  if (loadedScripts.has(src)) return Promise.resolve();
  loadedScripts.add(src);
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.charset = "utf-8";
    s.addEventListener("load", () => resolve());
    s.addEventListener("error", () => resolve());
    document.head.appendChild(s);
  });
}

function setText(root: ParentNode, selector: string, value: string): void {
  const el = root.querySelector<HTMLElement>(selector);
  if (el) el.textContent = value;
}

/** Enrich a single generic preview card in place. */
async function hydrateCard(card: HTMLElement): Promise<void> {
  if (card.getAttribute("data-link-hydrated") === "1") return;
  const url = card.getAttribute("data-src");
  if (!url) return;
  // Mark first to avoid duplicate in-flight requests across rapid re-renders.
  card.setAttribute("data-link-hydrated", "1");

  let meta: LinkPreview;
  try {
    meta = await api.get<LinkPreview>(`/api/link-preview?url=${encodeURIComponent(url)}`);
  } catch {
    return; // Leave the base card (host + Visit site) untouched.
  }

  if (meta.title) setText(card, ".cb-embed__title", meta.title);
  if (meta.siteName) setText(card, ".cb-embed__site", meta.siteName);
  if (meta.description) {
    let desc = card.querySelector<HTMLElement>(".cb-embed__desc");
    if (!desc) {
      desc = document.createElement("span");
      desc.className = "cb-embed__desc";
      card.querySelector(".cb-embed__url")?.before(desc);
    }
    desc.textContent = meta.description;
  }
  if (meta.image) {
    const existing = card.querySelector<HTMLImageElement>("img.cb-embed__thumb");
    if (existing) {
      existing.src = meta.image;
    } else {
      const placeholder = card.querySelector(".cb-embed__thumb--empty");
      const img = document.createElement("img");
      img.className = "cb-embed__thumb";
      img.src = meta.image;
      img.alt = "";
      img.loading = "lazy";
      placeholder?.replaceWith(img);
    }
  }
}

/**
 * Hydrate every URL embed inside `root`. Enriches generic preview cards and
 * loads any provider scripts they declare. Idempotent.
 */
export function hydrateLinkEmbeds(root: HTMLElement | null | undefined): void {
  if (!root || typeof window === "undefined") return;

  // 1. Generic preview cards.
  root
    .querySelectorAll<HTMLElement>('[data-link-hydrate="1"]:not([data-link-hydrated="1"])')
    .forEach((card) => void hydrateCard(card));

  // 2. Script-driven providers (X / Twitter, etc.).
  const scripts = new Set<string>();
  root.querySelectorAll<HTMLElement>("[data-embed-script]").forEach((el) => {
    const src = el.getAttribute("data-embed-script");
    if (src) scripts.add(src);
  });
  scripts.forEach((src) => {
    void loadScriptOnce(src).then(() => {
      const tw = (window as unknown as { twttr?: TwitterWidgets }).twttr;
      tw?.widgets?.load?.(root);
    });
  });
}
