"use client";

/**
 * Modal for the WYSIWYG "size" toolbar item: edits the size/preview
 * properties of the currently selected image, file embed, URL embed or code
 * block. Lives inside the article <form>, so it must not nest a form and
 * every button is type="button"; Enter applies, Escape closes.
 */
import { useState } from "react";
import type { SizableTarget } from "@/lib/embed-sizing";
import type { EmbedSize } from "@/lib/embeds";

type SizeMode = "none" | "small" | "medium" | "large" | "percent" | "pixels";

function modeOf(size: EmbedSize): SizeMode {
  switch (size.type) {
    case "preset":
      return size.size;
    case "percent":
      return "percent";
    case "pixels":
      return "pixels";
    default:
      return "none";
  }
}

const TITLES: Record<SizableTarget["kind"], string> = {
  image: "Image size",
  file: "Attachment size",
  url: "Link embed size",
  code: "Code block size & preview",
};

const inputCls =
  "w-full rounded border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent";
const labelCls =
  "mb-1 block text-xs font-semibold uppercase tracking-wide text-muted";

export function EmbedSizeDialog({
  target,
  onApply,
  onClose,
}: {
  target: SizableTarget;
  onApply: (next: SizableTarget) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<SizeMode>(() => modeOf(target.size));
  const [percent, setPercent] = useState(() =>
    target.size.type === "percent" ? String(target.size.width) : "50",
  );
  const [pxWidth, setPxWidth] = useState(() =>
    target.size.type === "pixels" ? String(target.size.width) : "640",
  );
  const [pxHeight, setPxHeight] = useState(() =>
    target.size.type === "pixels" && target.size.height > 0
      ? String(target.size.height)
      : "",
  );
  const [alt, setAlt] = useState(() =>
    target.kind === "image" ? target.alt : "",
  );
  const [urlOnly, setUrlOnly] = useState(() =>
    target.kind === "url" ? target.urlOnly : false,
  );
  const [previewLines, setPreviewLines] = useState(() =>
    target.kind === "code" && target.previewLines
      ? String(target.previewLines)
      : "",
  );
  const [collapseKind, setCollapseKind] = useState<"preview" | "collapse">(
    () => (target.kind === "code" ? target.collapseKind : "preview"),
  );

  const apply = () => {
    let size: EmbedSize;
    switch (mode) {
      case "small":
      case "medium":
      case "large":
        size = { type: "preset", size: mode };
        break;
      case "percent": {
        const w = parseInt(percent, 10);
        size =
          Number.isFinite(w) && w >= 1 && w <= 100
            ? { type: "percent", width: w }
            : { type: "none" };
        break;
      }
      case "pixels": {
        const w = parseInt(pxWidth, 10);
        if (!Number.isFinite(w) || w < 1) {
          size = { type: "none" };
        } else {
          const h = parseInt(pxHeight, 10);
          size = {
            type: "pixels",
            width: w,
            height: Number.isFinite(h) && h > 0 ? h : 0,
          };
        }
        break;
      }
      default:
        size = { type: "none" };
    }

    const pl = previewLines.trim() === "" ? NaN : parseInt(previewLines, 10);
    const nextPreviewLines =
      Number.isFinite(pl) && pl >= 1 ? pl : undefined;

    let next: SizableTarget;
    switch (target.kind) {
      case "image":
        next = { ...target, alt, size };
        break;
      case "file":
        next = { ...target, size };
        break;
      case "url":
        next = { ...target, size, urlOnly };
        break;
      case "code":
        next = {
          ...target,
          size,
          previewLines: nextPreviewLines,
          collapseKind,
        };
        break;
    }
    onApply(next);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
      <div
        data-testid="embed-size-dialog"
        className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-2xl"
        onKeyDown={(e) => {
          if (
            e.key === "Enter" &&
            (e.target as HTMLElement).tagName !== "BUTTON"
          ) {
            e.preventDefault();
            apply();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      >
        <h3 className="mb-4 text-base font-bold text-fg">
          {TITLES[target.kind]}
        </h3>

        {target.kind === "image" && (
          <div className="mb-3">
            <label className={labelCls} htmlFor="size-alt">
              Alt text
            </label>
            <input
              id="size-alt"
              data-testid="size-alt"
              type="text"
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              className={inputCls}
            />
          </div>
        )}

        <div className="mb-3">
          <label className={labelCls} htmlFor="size-mode">
            Size
          </label>
          <select
            id="size-mode"
            data-testid="size-mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as SizeMode)}
            className={inputCls}
            autoFocus
          >
            <option value="none">Default</option>
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
            <option value="percent">Percent width</option>
            <option value="pixels">Pixels</option>
          </select>
        </div>

        {mode === "percent" && (
          <div className="mb-3">
            <label className={labelCls} htmlFor="size-percent">
              Width (%)
            </label>
            <input
              id="size-percent"
              data-testid="size-percent"
              type="number"
              min={1}
              max={100}
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
              className={inputCls}
            />
          </div>
        )}

        {mode === "pixels" && (
          <div className="mb-3 grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="size-width">
                Width (px)
              </label>
              <input
                id="size-width"
                data-testid="size-width"
                type="number"
                min={1}
                value={pxWidth}
                onChange={(e) => setPxWidth(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="size-height">
                Height (px, optional)
              </label>
              <input
                id="size-height"
                data-testid="size-height"
                type="number"
                min={0}
                value={pxHeight}
                onChange={(e) => setPxHeight(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
        )}

        {target.kind === "url" && (
          <label className="mb-3 flex items-center gap-2 text-sm text-muted">
            <input
              data-testid="size-url-only"
              type="checkbox"
              checked={urlOnly}
              onChange={(e) => setUrlOnly(e.target.checked)}
              className="accent-accent"
            />
            Link only (no preview)
          </label>
        )}

        {target.kind === "code" && (
          <>
            <div className="mb-3">
              <label className={labelCls} htmlFor="size-preview-lines">
                Preview lines
              </label>
              <input
                id="size-preview-lines"
                data-testid="size-preview-lines"
                type="number"
                min={1}
                value={previewLines}
                onChange={(e) => setPreviewLines(e.target.value)}
                className={inputCls}
              />
              <p className="mt-1 text-xs text-muted">
                This block has {target.totalLines} lines; it collapses only
                when longer than the preview.
              </p>
            </div>
            <div className="mb-3">
              <label className={labelCls} htmlFor="size-collapse-kind">
                Collapse style
              </label>
              <select
                id="size-collapse-kind"
                data-testid="size-collapse-kind"
                value={collapseKind}
                onChange={(e) =>
                  setCollapseKind(e.target.value as "preview" | "collapse")
                }
                className={inputCls}
              >
                <option value="preview">preview</option>
                <option value="collapse">collapse</option>
              </select>
            </div>
          </>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-testid="size-cancel"
            onClick={onClose}
            className="rounded border border-border px-4 py-2 text-sm text-fg transition-colors hover:bg-border/40"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="size-apply"
            onClick={apply}
            className="rounded bg-accent px-4 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
