"use client";

/**
 * Social share modal. Opens from the article Share button and offers:
 *  - the OS share sheet on capable devices (navigator.share), and
 *  - credential-free intent links for the most-shared networks, plus copy-link.
 *
 * All sharing is URL-based (see lib/sharing/networks.ts): no API keys, no auth.
 * Facebook/LinkedIn previews come from the destination's OG <meta>, which the
 * per-article route emits — so we just point them at the canonical slug URL.
 *
 * Styling: structural chrome reads --cb-* tokens (see globals.scss .share-*),
 * and each theme (hacker / medium / substack) refines it in _themes.scss.
 * Animations: backdrop fades, the panel springs in, and the network tiles
 * stagger in; everything respects prefers-reduced-motion via the SCSS layer.
 */
import { useCallback, useEffect, useState } from "react";
import { X, Link as LinkIcon, Check, Share2, Mail } from "lucide-react";
import { useToast } from "@/components/toast";
import {
  buildShareTargets,
  toNativeShareData,
  type NetworkId,
  type SharePayload,
} from "@/lib/sharing/networks";

interface Props {
  open: boolean;
  onClose: () => void;
  payload: SharePayload;
  thumbnailUrl?: string | null;
}

/** Minimal inline brand glyphs (lucide ships no brand icons). */
function BrandIcon({ id }: { id: NetworkId }) {
  const common = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "currentColor" } as const;
  switch (id) {
    case "x":
      return (
        <svg {...common} aria-hidden>
          <path d="M18.244 2H21.5l-7.5 8.57L23 22h-6.9l-5.4-7.06L4.5 22H1.24l8.02-9.17L1 2h7.07l4.88 6.45L18.244 2Zm-1.21 18h1.91L7.06 4h-2.0l12.974 16Z" />
        </svg>
      );
    case "facebook":
      return (
        <svg {...common} aria-hidden>
          <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5 3.66 9.15 8.44 9.94v-7.03H7.9v-2.9h2.54V9.85c0-2.52 1.49-3.91 3.78-3.91 1.1 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.78-1.63 1.57v1.89h2.78l-.44 2.9h-2.34V22c4.78-.79 8.44-4.94 8.44-9.94Z" />
        </svg>
      );
    case "linkedin":
      return (
        <svg {...common} aria-hidden>
          <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29ZM5.34 7.43a2.07 2.07 0 1 1 0-4.14 2.07 2.07 0 0 1 0 4.14ZM7.12 20.45H3.55V9h3.57v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z" />
        </svg>
      );
    case "reddit":
      return (
        <svg {...common} aria-hidden>
          <path d="M22 12c0-1.1-.9-2-2-2-.53 0-1.02.21-1.38.55-1.36-.9-3.2-1.48-5.24-1.55l.9-4.2 2.92.62a1.5 1.5 0 1 0 .16-.98l-3.3-.7a.5.5 0 0 0-.59.38l-1 4.68c-2.08.06-3.95.64-5.33 1.55A1.99 1.99 0 0 0 2 12c0 .78.45 1.45 1.1 1.78a3.6 3.6 0 0 0-.04.56c0 2.84 3.54 5.15 7.9 5.15s7.9-2.31 7.9-5.15c0-.18-.01-.36-.04-.54A1.99 1.99 0 0 0 22 12ZM7.5 13.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Zm8.27 4.03c-.98.98-3.6.98-4.27.98s-3.29 0-4.27-.98a.4.4 0 0 1 .57-.57c.62.62 2.5.66 3.7.66 1.2 0 3.08-.04 3.7-.66a.4.4 0 1 1 .57.57ZM15 15a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z" />
        </svg>
      );
    case "whatsapp":
      return (
        <svg {...common} aria-hidden>
          <path d="M.06 24l1.68-6.13A11.86 11.86 0 0 1 .16 11.9C.16 5.34 5.5 0 12.06 0a11.82 11.82 0 0 1 8.41 3.49 11.82 11.82 0 0 1 3.48 8.42c0 6.56-5.34 11.9-11.9 11.9a11.9 11.9 0 0 1-5.68-1.45L.06 24ZM6.6 20.13c1.68 1 3.28 1.6 5.45 1.6 5.45 0 9.9-4.43 9.9-9.88a9.82 9.82 0 0 0-2.9-7A9.82 9.82 0 0 0 12.06 2c-5.46 0-9.9 4.44-9.9 9.9 0 2.24.66 3.92 1.76 5.6l-.98 3.58 3.66-.95Zm10.96-5.4c-.07-.12-.27-.2-.57-.35-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51l-.57-.01c-.2 0-.52.07-.79.37-.27.3-1.04 1.01-1.04 2.48 0 1.46 1.07 2.87 1.22 3.07.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.69.62.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2-1.41.25-.69.25-1.28.18-1.41Z" />
        </svg>
      );
    case "telegram":
      return (
        <svg {...common} aria-hidden>
          <path d="M23.91 3.79 20.3 20.84c-.25 1.21-.98 1.5-1.99.93l-5.5-4.05-2.65 2.55c-.3.3-.55.55-1.12.55l.4-5.65 10.3-9.3c.45-.4-.1-.62-.69-.22L6.06 12.32.96 10.73c-1.11-.35-1.13-1.11.23-1.64L22.49 2.2c.92-.35 1.73.22 1.42 1.59Z" />
        </svg>
      );
    case "email":
      return <Mail width={22} height={22} aria-hidden />;
  }
}

export function ShareModal({ open, onClose, payload, thumbnailUrl }: Props) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);

  // Feature-detect the Web Share API on the client only (avoids SSR mismatch).
  useEffect(() => {
    setCanNativeShare(
      typeof navigator !== "undefined" && typeof navigator.share === "function",
    );
  }, []);

  // Close on Escape and lock background scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  const targets = buildShareTargets(payload);

  const openTarget = useCallback((href: string) => {
    window.open(href, "_blank", "noopener,noreferrer,width=640,height=640");
  }, []);

  const nativeShare = useCallback(async () => {
    try {
      await navigator.share(toNativeShareData(payload));
    } catch {
      /* user dismissed or unsupported — non-fatal */
    }
  }, [payload]);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(payload.url);
      setCopied(true);
      toast.success("Article link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy link");
    }
  }, [payload.url, toast]);

  if (!open) return null;

  let host = payload.url;
  try {
    host = new URL(payload.url).host;
  } catch {
    /* keep raw url */
  }

  return (
    <div
      className="share-backdrop fixed inset-0 z-[60] flex items-end justify-start p-4 sm:items-end sm:justify-start"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Share this article"
    >
      <div
        className="share-modal w-full max-w-md rounded-t-2xl border border-border bg-card p-5 shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-heading text-lg font-bold text-fg">
            <Share2 className="h-5 w-5 text-accent" />
            Share
          </h3>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted transition-colors hover:text-fg"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Preview card mirrors what social crawlers will render from OG tags. */}
        <div className="share-preview mb-4 flex gap-3 rounded-xl border border-border p-3">
          {thumbnailUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbnailUrl}
              alt=""
              className="h-16 w-16 flex-none rounded-lg border border-border object-cover"
            />
          )}
          <div className="min-w-0">
            <p className="truncate font-semibold text-fg">{payload.title}</p>
            {payload.description && (
              <p className="line-clamp-2 text-sm text-muted">{payload.description}</p>
            )}
            <p className="mt-1 truncate text-xs text-accent">{payload.url}</p>
          </div>
        </div>

        {canNativeShare && (
          <button
            onClick={nativeShare}
            className="share-native mb-3 flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-2.5 text-sm font-semibold text-bg transition-transform hover:scale-[1.02] active:scale-95"
          >
            <Share2 className="h-4 w-4" />
            Share via device…
          </button>
        )}

        <div className="share-grid grid grid-cols-4 gap-2">
          {targets.map((t, i) => (
            <button
              key={t.id}
              onClick={() => openTarget(t.href)}
              className="share-net group flex flex-col items-center gap-1.5 rounded-xl border border-border bg-bg/40 py-3 text-muted transition-all hover:-translate-y-0.5 hover:border-accent hover:text-fg"
              style={{ ["--brand" as string]: t.brand, animationDelay: `${i * 40}ms` }}
              title={`Share on ${t.label}`}
            >
              <span className="share-net__icon transition-colors group-hover:text-[color:var(--brand)]">
                <BrandIcon id={t.id} />
              </span>
              <span className="text-[11px] font-medium">{t.label}</span>
            </button>
          ))}

          <button
            onClick={copyLink}
            className="share-net group flex flex-col items-center gap-1.5 rounded-xl border border-border bg-bg/40 py-3 text-muted transition-all hover:-translate-y-0.5 hover:border-accent hover:text-fg"
            style={{ animationDelay: `${targets.length * 40}ms` }}
            title="Copy link"
          >
            <span className="share-net__icon text-accent">
              {copied ? <Check className="h-[22px] w-[22px]" /> : <LinkIcon className="h-[22px] w-[22px]" />}
            </span>
            <span className="text-[11px] font-medium">{copied ? "Copied" : "Copy"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
